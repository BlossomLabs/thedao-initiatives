/** ASVS-02 evidence: asserts formula preservation, not desired secure behavior. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../../../app/routes/admin.leads.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("admin.leads.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "leadsCsv");
assert.ok(declaration, "The real leadsCsv function must exist");
const { outputText } = ts.transpileModule(declaration.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const context = { exports: {} };
vm.runInNewContext(outputText, context, { timeout: 1000 });
const input = "=1+1";
const output = context.exports.leadsCsv([{
  title: "Safe proposal", slug: "safe-proposal", type: "rfp", status: "pending",
  goalUsd: 100, funders: input, contact: "test@example.invalid", createdAt: 1800000000,
}]);
assert.match(output, /,=1\+1,/);
console.log(JSON.stringify({
  source: "app/routes/admin.leads.tsx:19", input, output,
  conclusion: "Formula is preserved as a CSV cell, not neutralized. No spreadsheet or external command executed.",
}, null, 2));
