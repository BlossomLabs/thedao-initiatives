# Wallet connection and sign-in

Wallet connection and SIWE authentication are separate states. Restoring a wallet, receiving an account event from another tab, or failing a signature does not grant a session and does not revoke wallet permissions. Signing in requires an explicit user action; protected actions still require a verified API session. Explicit sign-out ends the API session and disconnects the wallet. This prevents an idle tab from revoking the origin's MetaMask permissions while another tab is signing in.

The SIWE message names chain 1 and the API verifies it there (EIP-1271 for smart accounts), so `signIn()` first asks a wallet that reports another chain to switch to Ethereum. Ambire keeps a chain per site and answers `personal_sign` with EIP-1193 code 4901 ("The Provider is not connected to the requested chain") while that chain is not one of its enabled networks; the switch request is what resets it. A refused switch ends the sign-in like a refused signature.
