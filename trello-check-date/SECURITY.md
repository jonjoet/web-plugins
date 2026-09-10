# Security

This is a static, read-only personal Trello Power-Up. Custom API calls are GETs
to `https://api.trello.com/1`; redirects are rejected, browser credentials omitted,
and request referrers suppressed. Trello's SDK and consent flow are also required.
There is no backend, analytics, or app-owned persistent storage.

The app key is public and grants no account access by itself. Configuration and
builds may contain only that key. A user token is secret and must never be entered
in configuration, committed, included in build output, or logged. The SDK stores
authorization in Trello private plugin data; the application holds the retrieved
token in memory only while using it. This is not a browser-only localStorage
guarantee. Consent requests `scope: read` with `expiration: never`.

The UI renders Trello names as text. Integration reports contain fixed field
labels, counts, booleans, and sanitized error codes only. They omit names, IDs,
URLs, raw responses, and tokens. Browser developer tools can still expose private
responses and credential-bearing requests; do not share their network captures
or browser storage. Tests use synthetic credentials only.

To revoke a token, open your Trello account settings, find **Applications**, and
revoke this Power-Up's access. Trello commonly exposes settings at
`https://trello.com/u/YOUR_USERNAME/account`; follow the current account UI if it
redirects. **Forget authorization** in the preview only removes the SDK's stored
token. After revocation, the next API check should return to Authorize.

If a token leaks, revoke it immediately and authorize again. Report the affected
step and sanitized UI message; never include the token or full request URL.
