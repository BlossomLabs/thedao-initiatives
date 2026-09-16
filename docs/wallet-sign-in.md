# Wallet connection and sign-in

Wallet connection and SIWE authentication are separate states. Restoring a wallet, receiving an account event from another tab, or failing a signature does not grant a session and does not revoke wallet permissions. Signing in requires an explicit user action; protected actions still require a verified API session. Explicit sign-out ends the API session and disconnects the wallet. This prevents an idle tab from revoking the origin's MetaMask permissions while another tab is signing in.
