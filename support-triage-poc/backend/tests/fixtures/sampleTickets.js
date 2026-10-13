/**
 * Synthetic demo tickets. They exercise every team, SLA-risk band and policy rule.
 * They are NOT evidence of real-world accuracy or calibration.
 * Used only by the automated tests.
 */
export const SAMPLE_TICKETS = [
  {
    key: 'billing-double-charge',
    label: 'Billing: double charge',
    ticket: {
      subject: 'Customer charged twice for annual subscription renewal',
      description:
        'Our finance team noticed two identical charges for the annual Enterprise subscription on the same invoice date. Please refund the duplicate payment and confirm the invoice is correct.',
      logs: 'invoice_id=INV-88213 amount=48000.00 USD status=paid\ninvoice_id=INV-88214 amount=48000.00 USD status=paid',
      environment: 'production',
      affectedUsers: 1,
      minutesUntilSlaDeadline: 1440,
    },
  },
  {
    key: 'infra-eu-outage',
    label: 'Infrastructure: EU outage',
    ticket: {
      subject: 'Production API returning 502 for all EU users - outage',
      description:
        'Since 09:12 UTC every request to the EU region returns 502 Bad Gateway. All users cannot access the product. This is a full production outage.',
      logs:
        '2026-10-13T09:12:04Z gateway upstream=api-eu status=502 latency=30001ms\n' +
        '2026-10-13T09:12:05Z k8s pod api-eu-7f9c status=CrashLoopBackOff restarts=14\n' +
        '2026-10-13T09:12:06Z db primary-eu replication lag=480s\n' +
        'DEBUG config api_key=sk-test-1234567890abcdefXYZ (should be redacted before leaving the backend)',
      environment: 'production',
      affectedUsers: 12000,
      minutesUntilSlaDeadline: 30,
    },
  },
  {
    key: 'auth-saml-rotation',
    label: 'Auth: SSO failing after cert rotation',
    ticket: {
      subject: 'SSO login failing after SAML certificate rotation',
      description:
        'After rotating our IdP signing certificate this morning, users cannot log in via SAML SSO. They see "invalid signature" and are redirected back to the login page. MFA users are also locked out.',
      logs: 'saml: signature validation failed for assertion id=_a81f issuer=https://idp.fabrikam.example\nsession: login rejected reason=invalid_signature',
      environment: 'production',
      affectedUsers: 450,
      minutesUntilSlaDeadline: 120,
    },
  },
  {
    key: 'frontend-blank-charts',
    label: 'Frontend: charts render blank',
    ticket: {
      subject: 'Dashboard charts render blank in Safari',
      description:
        'In Safari 18 the analytics dashboard shows empty chart containers. The layout is fine and the data table below the chart displays correctly. Chrome works as expected.',
      logs: 'browser console: TypeError: undefined is not an object (evaluating "ctx.roundRect") at chart.js:1042',
      environment: 'staging',
      affectedUsers: 40,
      minutesUntilSlaDeadline: 2880,
    },
  },
  {
    key: 'ambiguous',
    label: 'Vague report',
    ticket: {
      subject: 'Things are not working since yesterday',
      description: 'Several people on my team say things are not working properly since yesterday. Please look into it urgently.',
      logs: '',
      environment: 'production',
      affectedUsers: 12,
      minutesUntilSlaDeadline: 600,
    },
  },
  {
    key: 'deadline-imminent',
    label: 'Billing: export failing, SLA in 3 min',
    ticket: {
      subject: 'Invoice export failing before month-end close',
      description:
        'The invoice CSV export fails with a generic error. Our finance team needs the billing export for month-end close today.',
      logs: 'export job=invoice_csv status=failed error="unexpected EOF"',
      environment: 'production',
      affectedUsers: 3,
      minutesUntilSlaDeadline: 3,
    },
  },
  {
    key: 'frontend-screenshot',
    label: 'Frontend: broken checkout button (screenshot)',
    withScreenshot: true,
    ticket: {
      subject: 'Checkout button misaligned and unclickable on mobile',
      description:
        'On mobile browsers the checkout button renders outside the viewport and overlaps the footer, so customers cannot complete orders. See the attached screenshot.',
      logs: '',
      environment: 'production',
      affectedUsers: 900,
      minutesUntilSlaDeadline: 60,
    },
  },
];
