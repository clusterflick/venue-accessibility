# venue-accessibility

Part of the Clusterflick project. Reviewed accessibility facts about London
cinemas and arts venues (their buildings and screens), with the rules that check
them. Read `README.md` before changing anything: it is the spec.

- **Never infer.** A status other than `unknown` is something a source said,
  with its quote. If no acceptable source says it, it is `unknown`.
- **Only a merged pull request changes `records/`.** That is what makes a record
  reviewed. Unreviewed facts go in `candidates/`.
- **Add a host to `lib/source-policy.js` before citing it.** The policy fails
  closed, deliberately.
- **Fail loudly.** Throw on data that doesn't fit rather than defaulting.
- Venue ids, attributes and fetching come from `scripts`
  (`github:clusterflick/scripts`); follow its patterns.

Run tests through `npm test`, which sets `TZ=Europe/London`.
