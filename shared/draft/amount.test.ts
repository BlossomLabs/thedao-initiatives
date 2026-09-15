import { parseAmount, usd } from "./amount.ts";

test("amount table: the last separator with 1-2 digits after it is the decimal point", () => {
  const table: [string, number][] = [
    ["150,000", 150000],
    ["150.000", 150000],
    ["150,00", 150],
    ["150.00", 150],
    ["1.234.567,89", 1234567.89],
    ["1,234,567.89", 1234567.89],
    ["$300,000 USD", 300000],
    ["300k", 300],
    ["", 0],
    ["abc", 0],
    ["50000", 50000],
  ];
  for (const [raw, n] of table) expect(parseAmount(raw)).toBe(n);
  expect(parseAmount(85500)).toBe(85500);
});

test("usd prints cents only when there are any", () => {
  expect(usd(150000)).toBe("$150,000");
  expect(usd(1234.5)).toBe("$1,234.50");
  expect(usd(0)).toBe("$0");
});
