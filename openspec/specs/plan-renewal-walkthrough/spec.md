# plan-renewal-walkthrough Specification

## Purpose

Surfaces around the user's paid subscription lifecycle: a renewal banner shown in the unlocked shell as `paidUntil` approaches, a non-blocking `GatedSheet` over the unlocked shell when sync flips to `gated` (rather than a forced view switch into the plan picker), a pre-OAuth informational `PlanPreviewCard` on the welcome wizard, a return-to-source contract for upgrades launched from `DeviceLimitScreen`, and a one-time confirmation of new entitlements after every plan change.

Source files: `src/components/RenewBanner.tsx`, `src/components/GatedSheet.tsx`, `src/components/PlanPreviewCard.tsx`, `src/components/PlanChangedConfirmation.tsx`, `src/components/AppShell.tsx`, `src/components/DeviceLimitScreen.tsx`.

## Requirements

### Requirement: RenewBanner is visible in the unlocked shell

The `RenewBanner` component SHALL be mounted inside `UnlockedShell` (`src/components/AppShell.tsx`) immediately above the daily-schedule header. The banner MUST render only when the existing logic in `RenewBanner.tsx` returns non-null (paid tier with `paidUntil` within 7 days, OR in grace). Tapping the banner MUST route to `view === 'plan'`. The currently-orphaned `RenewBanner` import (no consumer) MUST be replaced by an actual mount.

#### Scenario: Banner appears 5 days before expiry
- **GIVEN** a paid `pro-monthly` subscription with `paidUntil = now + 5 days`
- **WHEN** the unlocked shell renders
- **THEN** the renewal banner is visible above the schedule
- **AND** its label reads "Předplatné končí za 5 dní"
- **AND** tapping it sets `view === 'plan'`

#### Scenario: Banner does not appear at 14 days
- **GIVEN** a paid subscription with `paidUntil = now + 14 days`
- **WHEN** the unlocked shell renders
- **THEN** no renewal banner is rendered

#### Scenario: Banner appears in grace and links to plan picker
- **GIVEN** a paid subscription with `paidUntil = now - 3 days` and `gracePeriodSeconds = 7 * 86400`
- **WHEN** the unlocked shell renders
- **THEN** the renewal banner is visible
- **AND** its background uses the warning copper-amber tone
- **AND** tapping it routes to plan picker

### Requirement: Mid-flight `gated` is a non-blocking sheet, not a forced view switch

When `syncState.status === 'gated'` and `view === 'unlocked'`, the application SHALL render a bottom sheet `GatedSheet` over the unlocked shell INSTEAD of forcing `setView('plan')`. The sheet MUST contain:

- A heading explaining what happened ("Předplatné vypršelo").
- A reassurance line ("Tvá data zůstávají v zařízení; synchronizace se obnoví hned po obnovení.").
- Two buttons: "Obnovit" (→ plan picker) and "Pokračovat offline" (→ dismiss).

Dismissing the sheet MUST NOT clear the gated state; the next time `syncState.status === 'gated'` is observed (e.g. after app launch), the sheet MUST re-open. The sheet MUST be re-openable manually from the renewal banner.

The current `AppShell` effect that does `setView('plan')` on `s.status === 'gated'` MUST be removed.

#### Scenario: Gated mid-task shows the sheet, not a forced view switch
- **GIVEN** the user is mid-appointment on `view === 'unlocked'`
- **WHEN** sync flips to `gated`
- **THEN** `view === 'unlocked'` (unchanged)
- **AND** `GatedSheet` is rendered over the schedule
- **AND** the user can tap "Pokračovat offline" and continue working

#### Scenario: Sheet re-opens after relaunch if still gated
- **GIVEN** the user dismissed the sheet and closed the app
- **WHEN** the user reopens the app and unlocks
- **THEN** sync probes the server, observes `gated`, and re-opens the sheet
- **AND** the user has the same two options again

### Requirement: Pre-OAuth plan-preview card on the welcome wizard

The welcome wizard MUST render a small `PlanPreviewCard` between the brand wordmark and Step 1 (regardless of launch mode). The card MUST list the headline differences between Free, Pro, and Max in three columns or stacked rows. It MUST be read-only (no plan selection) — the user picks a plan after sign-in. The card MUST be dismissible via a quiet "Skrýt" link; the dismissal MUST persist in `localStorage` (`tricho-plan-preview-dismissed: '1'`) for this device.

The card MUST NOT block step 1, MUST NOT capture focus, and MUST NOT inject any tracking pixels or analytics calls — it is informational only.

#### Scenario: First-mount renders the preview card
- **GIVEN** `localStorage.getItem('tricho-plan-preview-dismissed') === null`
- **WHEN** the welcome wizard mounts
- **THEN** the `PlanPreviewCard` is rendered above Step 1
- **AND** it lists three plan tiers with their device limits and backup retention

#### Scenario: Dismissed preview stays hidden
- **GIVEN** the user previously tapped "Skrýt" on the preview card
- **WHEN** the welcome wizard mounts again
- **THEN** the preview card is not rendered

### Requirement: Upgrade hand-off from device-limit returns to device-limit

When the user enters the plan picker via `DeviceLimitScreen`'s "Upgradnout místo revokace" CTA, the picker MUST track the entry source and return to `DeviceLimitScreen` after a successful upgrade (Stripe checkout return, or bank-transfer paid status). On return, `DeviceLimitScreen` MUST refetch the device list and the subscription so the visible `deviceLimit` is up to date.

If the upgrade is cancelled or pending (bank transfer not yet confirmed), the user MUST be returned to `DeviceLimitScreen` with the original tier still in effect, and a non-blocking note "Upgrade probíhá — zkus znovu, jakmile se zaúčtuje."

#### Scenario: Stripe upgrade returns to device-limit
- **GIVEN** the user is on `DeviceLimitScreen` (pre-unlock) and taps the upgrade CTA
- **WHEN** Stripe checkout completes successfully
- **THEN** the `success_url` includes `?from=device-limit`
- **AND** on return, `DeviceLimitScreen` is the rendered surface
- **AND** the visible `deviceLimit` reflects the new plan

### Requirement: Plan-changed surface confirms the new entitlements

After a successful plan change (upgrade, downgrade, or renewal), the application SHALL render a one-time confirmation surface listing the new entitlements before returning to the prior view. The confirmation MUST display: new tier label, billing period, `deviceLimit`, `backupRetentionMonths`, next charge date, and a single "Pokračovat" button.

The confirmation MUST appear at most once per plan change (gated on a `lastShownAt` field in `tricho_meta`); subsequent app launches MUST NOT re-trigger it.

#### Scenario: Successful upgrade shows confirmation once
- **GIVEN** the user just upgraded from `pro-monthly` to `max-yearly`
- **WHEN** the app receives the updated subscription
- **THEN** a confirmation surface is rendered with "Plán Max · roční" heading
- **AND** the entitlement details are listed
- **AND** the surface persists until the user taps "Pokračovat"

#### Scenario: Confirmation does not re-trigger on next launch
- **GIVEN** the confirmation was shown 2 days ago for the current plan
- **WHEN** the app launches today and the subscription has not changed
- **THEN** the confirmation is not rendered
