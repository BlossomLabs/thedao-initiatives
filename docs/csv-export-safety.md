# Funder leads CSV export

The administration export remains UTF-8, comma-delimited CSV with the existing eight columns.
Records use CRLF line endings. Actual numeric `goal_usd` values stay numeric. Every text field is
quoted, embedded double quotes are doubled, and embedded newlines stay inside their original cell.

Text that could begin a spreadsheet formula receives a visible `Text: ` prefix. Detection covers
`=`, `+`, `-`, `@`, their full-width counterparts, and leading whitespace, control characters,
invisible formatting characters, or quotes before those operators. Leading control/format characters
are also prefixed on their own. The original value remains intact after the prefix. This includes
legitimate text such as international phone numbers starting with `+`; CRM users will see the prefix.

We chose an ordinary, visible text marker because spreadsheet-specific apostrophe/tab escapes can
be removed or handled differently by consumers. OWASP documents these limits and warns that
apostrophe escaping can fail when Excel saves and reopens a CSV. See
[OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

The supported interchange is a CSV importer configured for comma delimiters and standard quoted
fields that retains the exported text. Removing the marker or rewriting a cell as a formula defeats
the protection. A consumer must not silently strip it during import. Consumers requiring exact
original strings should retain the marker during spreadsheet handling and review it explicitly in
their CRM workflow.

Automated regression tests check dangerous prefixes, unexpected runtime field types, separators,
embedded quotes/newlines, original field boundaries, numeric values, and a parse/write/parse round
trip. This is not an Excel or LibreOffice execution test. No desktop spreadsheet save/reopen behavior
has been verified in this change; importing the harmless regression examples in each supported
spreadsheet remains a release validation step before claiming application-specific certification.
