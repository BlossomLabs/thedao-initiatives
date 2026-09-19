import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "~/components/ui/Dialog";
import { Button } from "~/components/ui/Button";
import { api, errorMessage } from "~/lib/api";
import { avatarSrc, PRESET_COUNT, presetUri } from "~/lib/avatar";
import { prepareAvatar } from "~/lib/avatar-image";
import { useSession } from "~/context/session";
import { useIdentity } from "~/hooks/use-identity";
import { cn } from "~/lib/utils";
import { NICKNAME_MAX } from "@shared/profile";
import { inputMax, tooLong } from "@shared/draft/mod";

const ENS_APP = "https://app.ens.domains";

/**
 * Pick a display name + avatar (preset or upload) for the signed-in wallet.
 * Fields that come from ENS (primary name, avatar record) are shown locked:
 * they always take precedence and can only be changed on ENS itself.
 */
export default function NicknameDialog({
  open,
  onOpenChange,
  firstTime,
  uploadsEnabled,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firstTime?: boolean;
  uploadsEnabled?: boolean;
  onDone?: () => void;
}) {
  const { address, requireSession, refreshMe } = useSession();
  const identity = useIdentity(address);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [pfp, setPfp] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameLocked = identity.nameFromEns;
  const avatarLocked = identity.avatarFromEns;
  const allLocked = nameLocked && avatarLocked;

  useEffect(() => {
    if (!open) return;
    setName(identity.nickname ?? "");
    setPfp(identity.pfp);
    setFile(null);
    setPreview(null);
    setError("");
  }, [open, identity.nickname, identity.pfp]);

  const currentSrc = avatarLocked ? identity.avatar : preview ??
    (pfp.startsWith("preset:") ? presetUri(parseInt(pfp.slice(7), 10) || 0) : identity.avatar);

  /** Square, shrink and re-encode in the browser so any picture fits the server's limits. */
  async function pickFile(f: File | null) {
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    if (!f) return;
    setPreparing(true);
    setError("");
    try {
      const prepared = await prepareAvatar(f);
      setFile(prepared);
      setPreview(URL.createObjectURL(prepared));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  }

  async function submit() {
    if (!address) return;
    const trimmed = name.trim();
    if (!nameLocked && trimmed.length > NICKNAME_MAX) {
      setError(tooLong("The name", NICKNAME_MAX));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requireSession();
      if (!nameLocked && trimmed && trimmed !== identity.nickname) {
        await api("/api/nickname", { json: { nickname: trimmed } });
      }
      if (!avatarLocked) {
        if (file) {
          const form = new FormData();
          form.append("image", file);
          await api("/api/pfp/upload", { form });
        } else if (pfp.startsWith("preset:") && pfp !== identity.pfp) {
          await api("/api/pfp", { json: { pfp } });
        }
      }
      await qc.invalidateQueries({ queryKey: ["profile", address.toLowerCase()] });
      await refreshMe();
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const title = allLocked
    ? "Your name and picture"
    : firstTime
    ? (nameLocked
      ? "Pick a picture"
      : identity.hasName
      ? "Complete your profile"
      : "Pick a display name")
    : "Your name and picture";
  const description = allLocked
    ? "Both come from your ENS profile and are used as-is on the board."
    : firstTime
    ? "Shown instead of your wallet address on donations and comments. A name like yours.eth works only if this wallet owns it."
    : "Change how you appear on the board. Domain names must be owned by this wallet.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {nameLocked
        ? (
          <div className="field rounded-xl px-[13px] py-[11px] text-white/80">
            {identity.ens}
            <p className="m-0 mt-1 text-[12px] text-muted">
              Your ENS primary name. Change it at{" "}
              <a href={ENS_APP} target="_blank" rel="noopener">app.ens.domains</a>.
            </p>
          </div>
        )
        : (
          <input
            className="field rounded-xl px-[13px] py-[11px]"
            value={name}
            maxLength={inputMax(NICKNAME_MAX)}
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        )}
      <p className="mt-1.5 font-inter-tight text-[12px] font-semibold text-soft">Avatar</p>
      {avatarLocked
        ? (
          <p className="m-0 text-[12px] text-muted">
            Your ENS avatar record. Change it at{" "}
            <a href={ENS_APP} target="_blank" rel="noopener">app.ens.domains</a>.
          </p>
        )
        : (
          <>
            <div className="grid grid-cols-5 gap-[9px]">
              {Array.from({ length: PRESET_COUNT }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={cn(
                    "rounded-full border-2 p-[3px] leading-none",
                    pfp === `preset:${i}` && !preview
                      ? "border-dao-green"
                      : "border-transparent hover:border-white/30",
                  )}
                  onClick={() => {
                    setPfp(`preset:${i}`);
                    setFile(null);
                    setPreview(null);
                  }}
                >
                  <img src={presetUri(i)} alt={`Preset ${i + 1}`} className="block rounded-full" />
                </button>
              ))}
            </div>
            {uploadsEnabled && (
              <div className="mt-0.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  sm
                  variant="ghost"
                  loading={preparing}
                  onClick={() => fileRef.current?.click()}
                >
                  Upload a picture
                </Button>
              </div>
            )}
          </>
        )}
      <img
        src={currentSrc || avatarSrc(address ?? "")}
        alt=""
        className="mt-2 block size-14 rounded-full border-2 border-dao-green object-cover"
      />
      {error && <p className="m-0 text-[12.5px] text-[#ffd7d6]" role="alert">{error}</p>}
      <div className="mt-0.5 flex gap-2.5">
        <Button className="flex-1" variant="ghost" sm onClick={() => onOpenChange(false)}>
          {allLocked ? "Close" : firstTime ? "Skip for now" : "Cancel"}
        </Button>
        {!allLocked && (
          <Button className="flex-1" variant="primary" sm loading={busy} onClick={submit}>
            Save
          </Button>
        )}
      </div>
    </Dialog>
  );
}
