## MODIFIED Requirements

### Requirement: Landing-page CTAs collect invite requests via Brevo while the app is invite-only

While Tricho.app is invite-only, the landing-page primary CTA MUST be an invite-request form that collects an e-mail address and submits it directly to Brevo's hosted form endpoint. The CTA model SHALL be:

- The Hero section MUST render an inline `<InviteForm>` (e-mail input + submit button) in place of the previous "Začít zdarma" button.
- The Final-CTA section MUST render an inline `<InviteForm>` (e-mail input + submit button) and MUST carry the anchor id `pozvanka`. The previous `#stahnout` id MUST be removed.
- The sticky `<Header>` and the Pricing Free block MUST each render an anchor button labelled "Požádat o pozvánku" whose href is `#pozvanka` and which scrolls to the Final-CTA section.
- No browser-visible CTA on the landing page MAY link to `/app/` while the app is invite-only. The pre-existing `<LaunchAppLink>` is exempt because it carries the `hidden` attribute and is revealed only when `display-mode: standalone` is detected — a visitor in that mode is already inside the installed PWA and therefore already has an invite.
- The invite form MUST submit to the Brevo hosted form endpoint via a JavaScript `fetch` POST with `mode: 'no-cors'`. No Brevo iframe, no Brevo embed script, no third-party SDK MAY be loaded.
- The form MUST have a native `<form action="<brevo-url>" method="POST">` fallback so submission still works with JavaScript disabled. A non-JS submission MAY navigate to Brevo's hosted thank-you page.
- The form MUST display an inline success message on the landing page after a successful POST (no navigation), and an inline error message if `fetch` throws a network error. The error message MUST suggest contacting `ahoj@tricho.app` as a fallback.
- The form MUST include the Brevo honeypot field (`email_address_check`, hidden, must remain empty), `locale=cs`, and `html_type=simple`.
- All copy on the form (label, placeholder, submit label, helper text, success message, error message) MUST come from `web/src/content/landing.ts:inviteForm`.

#### Scenario: Hero renders the invite form, not a sign-up button
- **GIVEN** the production build of `/`
- **WHEN** the Hero section is parsed
- **THEN** there is an `<form data-invite-form>` element with an `<input type="email" name="EMAIL" required>` and a submit `<button>`
- **AND** there is no `<a href="/app/">` inside the Hero

#### Scenario: Final-CTA section anchors as `#pozvanka`
- **GIVEN** the rendered landing page
- **WHEN** any CTA `<a href>` on the page is enumerated
- **THEN** every primary-CTA link with the label "Požádat o pozvánku" (Header, Pricing Free block) has `href="#pozvanka"`
- **AND** the Final-CTA `<section>` has `id="pozvanka"`
- **AND** the only `href="/app/"` on the page is the `<LaunchAppLink>` carrying the `hidden` attribute (revealed by JS only in standalone mode)

#### Scenario: Form posts directly to Brevo via fetch with no-cors
- **GIVEN** JavaScript is enabled
- **AND** the user types `someone@example.com` into the invite form and submits
- **WHEN** the network is inspected
- **THEN** exactly one POST is made to `https://2f4a10db.sibforms.com/serve/MUIF…` (the Brevo endpoint)
- **AND** the request mode is `no-cors`
- **AND** the request body contains `EMAIL=someone@example.com`, `email_address_check=`, `locale=cs`, and `html_type=simple`
- **AND** no other third-party domain is contacted

#### Scenario: Successful submission shows inline success, does not navigate
- **GIVEN** JavaScript is enabled and the Brevo POST resolves
- **WHEN** the form completes the submission
- **THEN** the inline success status (`[data-invite-status="ok"]`) becomes visible
- **AND** the e-mail input is reset
- **AND** the URL of the page does not change

#### Scenario: Submission falls back to native form post when JavaScript is disabled
- **GIVEN** JavaScript is disabled
- **WHEN** the user submits the invite form
- **THEN** the browser performs a native form POST to the Brevo `action` URL
- **AND** Brevo's hosted thank-you page is reached

#### Scenario: Honeypot remains empty
- **GIVEN** any rendered InviteForm on the page
- **WHEN** the DOM is inspected
- **THEN** `<input name="email_address_check">` is present
- **AND** its initial value is the empty string
- **AND** it is positioned off-screen so a human user does not see it

## REMOVED Requirements

### Requirement: Landing-page CTA placements all link to the PWA shell
**Reason**: Tricho.app is invite-only; sign-up is closed and `/app/` is not reachable to new users without an invite. The previous "four CTAs all → `/app/`" model has been replaced by the invite-request form (see the new requirement above) and a single canonical anchor `#pozvanka` for header / Free-block buttons.
**Migration**: The `<a href="/app/">Začít zdarma</a>` instances on the landing page are removed. Existing inbound links to `/app/` from external pages still work — only the landing-page CTAs are affected.
