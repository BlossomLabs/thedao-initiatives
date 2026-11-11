// Signs paper codes for test votes and lays them out for printing. Run it yourself, with
// the issuer key in the environment (never in a file the server reads):
//
//   VOTE_ISSUER_KEY=0x… deno task vote-codes --from 1 --to 200 --base-url https://…
//
// Writes vote-codes/codes.csv and vote-codes/codes.pdf (git-ignored) and prints
// the issuer address, which is all the site needs (the manifest).
import { parseArgs } from "jsr:@std/cli@1.0.24/parse-args";
import { privateKeyToAccount } from "viem/accounts";
import QRCode from "npm:qrcode@1.5.4";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { codeMessage, formatCode } from "../shared/vote/code.ts";

export type SignedCode = { n: number; url: string };

export async function signCodes(
  key: `0x${string}`,
  from: number,
  to: number,
  baseUrl: string,
): Promise<SignedCode[]> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) {
    throw new Error("--from and --to must be whole numbers with 1 <= from <= to");
  }
  const account = privateKeyToAccount(key);
  const base = baseUrl.replace(/\/+$/, "");
  const out: SignedCode[] = [];
  for (let n = from; n <= to; n++) {
    const sig = await account.signMessage({ message: codeMessage(n) });
    out.push({ n, url: `${base}/vote/${formatCode(n, sig)}` });
  }
  return out;
}

const MM = 72 / 25.4;
const COLS = 4;
const ROWS = 5;

/** A4 pages, 4 × 5 cells with cut lines, a 38 mm QR and the number under each. */
export async function codesPdf(codes: SignedCode[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const [W, H] = [210 * MM, 297 * MM];
  const cellW = W / COLS;
  const cellH = H / ROWS;
  const qr = 38 * MM;
  for (let i = 0; i < codes.length; i += COLS * ROWS) {
    const page = doc.addPage([W, H]);
    for (let c = 1; c < COLS; c++) {
      page.drawLine({
        start: { x: c * cellW, y: 0 },
        end: { x: c * cellW, y: H },
        thickness: 0.3,
        color: rgb(0.8, 0.8, 0.8),
        dashArray: [3, 3],
      });
    }
    for (let r = 1; r < ROWS; r++) {
      page.drawLine({
        start: { x: 0, y: r * cellH },
        end: { x: W, y: r * cellH },
        thickness: 0.3,
        color: rgb(0.8, 0.8, 0.8),
        dashArray: [3, 3],
      });
    }
    for (const [k, code] of codes.slice(i, i + COLS * ROWS).entries()) {
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      const x0 = col * cellW;
      const y0 = H - (row + 1) * cellH;
      const png = await QRCode.toBuffer(code.url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 600,
      });
      const img = await doc.embedPng(png);
      page.drawImage(img, {
        x: x0 + (cellW - qr) / 2,
        y: y0 + cellH - qr - 4 * MM,
        width: qr,
        height: qr,
      });
      const label = `#${code.n}`;
      page.drawText(label, {
        x: x0 + (cellW - font.widthOfTextAtSize(label, 12)) / 2,
        y: y0 + 9 * MM,
        size: 12,
        font,
      });
      const hint = "Badge holder for a day";
      page.drawText(hint, {
        x: x0 + (cellW - small.widthOfTextAtSize(hint, 7)) / 2,
        y: y0 + 5 * MM,
        size: 7,
        font: small,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  }
  return await doc.save();
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, { string: ["from", "to", "base-url", "out"] });
  const key = Deno.env.get("VOTE_ISSUER_KEY")?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("Set VOTE_ISSUER_KEY to the issuer's private key (0x + 64 hex).");
    Deno.exit(1);
  }
  const baseUrl = args["base-url"];
  if (!baseUrl) {
    console.error("--base-url is required, e.g. https://initiatives.thedao.fund");
    Deno.exit(1);
  }
  const outDir = args.out ?? "vote-codes";
  const codes = await signCodes(
    key as `0x${string}`,
    Number(args.from ?? 1),
    Number(args.to ?? 200),
    baseUrl,
  );
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(
    `${outDir}/codes.csv`,
    "n,url\n" + codes.map((c) => `${c.n},${c.url}`).join("\n") + "\n",
  );
  await Deno.writeFile(`${outDir}/codes.pdf`, await codesPdf(codes));
  console.log(`Wrote ${codes.length} codes to ${outDir}/codes.csv and ${outDir}/codes.pdf`);
  console.log(
    `Issuer address: ${privateKeyToAccount(key as `0x${string}`).address}`,
  );
}
