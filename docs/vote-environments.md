# Production and test votes

Both votes run in the same deployment, sharing accounts and initiative listings. Their round configuration, voting state, browser drafts, results and administration are independent.

| Surface | Production | Test |
| --- | --- | --- |
| Results | `/vote` | `/vote-test` |
| Ballot | `/vote/ballot` | `/vote-test/ballot` |
| Editor | `/vote/ballot/edit` | `/vote-test/ballot/edit` |
| Admin | `/admin/vote` | `/admin/vote-test` |
| API | `/api/vote/*` | `/api/vote-test/*` |
| Admin API | `/api/admin/vote-round/*` | `/api/admin/vote-test-round/*` |
| Agent instructions | `/vote/llms.txt` | `/vote-test/llms.txt` |
| Network | Ethereum | Sepolia |
| Metadata key | `vote_round_production` | `vote_round_test` |

The homepage reflects production only. Test results retain their voter/admin access gate. Examples live under `/vote-test/mock/*`, `/vote-test/results/*` and `/vote-test/effects`; their banner identifies them as demonstrations. Test donations and pledges affect the test contract only.

Round records use `["vote", environment, chainId, lowercaseContract, ...]`. Browser storage and query caches include environment and round identity. Sender nonce coordination remains shared by chain and sender because it belongs to that account.

## Deployment and migration

Deploy this change before configuring both votes. Do not run old and new server versions concurrently while accepting voting writes: the old server uses the former database namespace.

At startup, the legacy `vote_round` setting is copied into the environment matching its manifest kind, only if that environment has no setting. Associated chain-and-contract records are copied without overwriting destination records; transient caches and pending entries are not copied. Original records remain intact. The per-environment migration marker makes retries safe. Unidentified historic rounds and old address-only records remain untouched; they are not imported into either active environment.

Check both admin pages after rollout. Configure production on Ethereum and testing on Sepolia separately. An absent round stays unavailable; it never borrows the other environment's configuration. Clearing test configuration does not clear production. Once production opens, its existing round protections remain in force.

Share `/vote-test/ballot` with existing testers. Old `/vote/ballot` links now identify production explicitly. Old browser drafts are not automatically imported; testers must reopen their ballot in the test environment.

## Scripts and checks

`vote-sim` reads `/api/vote-test/*` and rejects production manifests. For replay from a site, select `--environment production` or `--environment test`. A local `--manifest` file already identifies its round.

Before enabling voting after deployment, check each manifest endpoint, open both ballot pages in separate tabs, and confirm each banner and wallet request identifies the expected network and contract. Check that each admin page changes only its own configuration. No contract deployment or on-chain migration is performed by this application change.
