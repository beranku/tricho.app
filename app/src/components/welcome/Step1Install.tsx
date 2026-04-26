import React from 'react';
import type { BrowserFamily, LaunchMode } from '../../lib/launch-mode';
import { IosShareIcon, KebabIcon } from './icons';
import { m } from '../../i18n';

interface Step1InstallProps {
  launchMode: LaunchMode;
  browser: BrowserFamily;
  installed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Step 1 body. Renders install instructions in `browser` mode and a
 * post-install message after `confirmInstallation()`. Components for
 * Step 2 / Step 3 are not mounted while `launchMode === 'browser'` —
 * that gate lives in `OnboardingWizard`. This component just owns the
 * Step 1 surface.
 */
export function Step1Install({
  browser,
  installed,
  onConfirm,
  onCancel,
}: Step1InstallProps): JSX.Element {
  if (installed) {
    return (
      <div className="step1-post">
        <h3
          className="step-section-title"
          style={{
            fontFamily: "'Fraunces', serif",
            fontVariationSettings: "'opsz' 22",
            fontSize: 18,
            margin: '0 0 8px',
          }}
        >
          {m.wizard_step1_post_title()}
        </h3>
        <p
          style={{
            fontFamily: "'Geist', system-ui, sans-serif",
            fontSize: 14,
            color: 'var(--ink-2)',
            lineHeight: 1.5,
            margin: '0 0 14px',
          }}
        >
          {m.wizard_step1_post_body()}
        </p>
        <p
          className="qr-warning"
          style={{ textAlign: 'left', marginBottom: 16 }}
        >
          {m.wizard_step1_post_warning()}
        </p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onCancel}
          data-testid="wizard-step1-cancel"
        >
          {m.wizard_step1_post_back()}
        </button>
      </div>
    );
  }

  const rows = pickRows(browser);

  return (
    <div className="step1-pre">
      <ul className="install-timeline" role="list">
        {rows.map((row, idx) => (
          <li key={idx} className="install-row">
            <span className="install-row__dot" aria-hidden="true" />
            <span className="install-row__text">
              <span className="install-row__label">{row.label}</span>
              <span className="install-row__hint">{row.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={onConfirm}
        data-testid="wizard-step1-confirm"
        style={{ marginTop: 14 }}
      >
        {m.wizard_step1_cta_installed()}
      </button>
    </div>
  );
}

interface InstallRow {
  label: React.ReactNode;
  hint: string;
}

function pickRows(browser: BrowserFamily): InstallRow[] {
  if (browser === 'ios') {
    return [
      {
        label: (
          <>
            {prefixToGlyph(m.wizard_step1_ios_step1())[0]}
            <IosShareIcon />
            {prefixToGlyph(m.wizard_step1_ios_step1())[1]}
          </>
        ),
        hint: m.wizard_step1_ios_step1_hint(),
      },
      {
        label: m.wizard_step1_ios_step2(),
        hint: m.wizard_step1_ios_step2_hint(),
      },
      {
        label: m.wizard_step1_ios_step3(),
        hint: m.wizard_step1_ios_step3_hint(),
      },
    ];
  }
  if (browser === 'android') {
    return [
      {
        label: (
          <>
            {androidPrefix(m.wizard_step1_android_step1())[0]}
            <KebabIcon />
            {androidPrefix(m.wizard_step1_android_step1())[1]}
          </>
        ),
        hint: m.wizard_step1_android_step1_hint(),
      },
      {
        label: m.wizard_step1_android_step2(),
        hint: m.wizard_step1_android_step2_hint(),
      },
      {
        label: m.wizard_step1_android_step3(),
        hint: m.wizard_step1_android_step3_hint(),
      },
    ];
  }
  return [
    { label: m.wizard_step1_other_step1(), hint: m.wizard_step1_other_step1_hint() },
    { label: m.wizard_step1_other_step2(), hint: m.wizard_step1_other_step2_hint() },
    { label: m.wizard_step1_other_step3(), hint: m.wizard_step1_other_step3_hint() },
  ];
}

/** Splits the iOS row 1 copy around the "share ikonu" / "share icon" phrase. */
function prefixToGlyph(text: string): [string, string] {
  const idx = text.toLowerCase().indexOf('share');
  if (idx === -1) return [text, ''];
  return [text.slice(0, idx), text.slice(idx)];
}

/** Splits the Android row 1 copy around the "⋮" placeholder. */
function androidPrefix(text: string): [string, string] {
  const idx = text.indexOf('⋮');
  if (idx === -1) return [text, ''];
  return [text.slice(0, idx), text.slice(idx + 1)];
}
