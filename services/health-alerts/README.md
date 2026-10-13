# Detection and sound error alerts

This service is prepared but is not deployed. No test email has been sent.
The extension sends reports only when a user turns on **Send error reports**.
The repair function works with this setting off.

The service sends an email to `moochie@discofish.lol` after three matching reports within 30 minutes.
It groups reports by error code, extension version, and selector fingerprint.
It sends at most one email each hour. These are report counts, not counts of verified users.
After three reports meet the threshold, the service keeps the alert through the hourly wait.
Later reports do not erase the alert or extend the email retry interval.
The application removes report groups after 24 hours without a new report.

The website can stay on Cloudways. This configuration uses a Cloudflare Worker route for `chatdinger.com/api/dinger-health`.
Cloudflare Email Service requires Cloudflare DNS and a configured sender domain.
See [the Cloudflare email setup guide](https://developers.cloudflare.com/email-service/get-started/send-emails/).

## Setup

1. Install Node.js 22 or later.
2. Add `chatdinger.com` to the Cloudflare account, if necessary.
3. Keep the website DNS record pointed at the Cloudways server.
4. Set the website DNS record to **Proxied** for the Worker route.
5. Open **Compute > Email Service > Email Sending** in Cloudflare.
6. Configure `chatdinger.com` as a sender domain.
7. Check the sender DNS records in Cloudflare.
8. Check `ALERT_FROM` and `ALERT_TO` in `wrangler.jsonc`.
9. From the repository root, run `npx --yes wrangler@4.140.0 login`.
10. Run the build check below.
11. Run the deployment command below.

Build check:

```sh
npx --yes wrangler@4.140.0 deploy --dry-run --config services/health-alerts/wrangler.jsonc
```

Deployment:

```sh
npx --yes wrangler@4.140.0 deploy --config services/health-alerts/wrangler.jsonc
```

The Worker uses a Durable Object, a Rate Limiting binding, and an Email binding.
The Email binding permits only the owner address.
The service uses the [Cloudflare structured email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
The build check does not check account access, sender verification, DNS routing, or email delivery.

## Check the deployed service

1. Open `https://chatdinger.com/api/dinger-health`.
2. Make sure the response has `"ready": true`.
3. Run the command below to send three test reports.
4. Check `moochie@discofish.lol` for the test alert.
5. Check the spam folder if the alert is absent.
6. Set phone notifications for this sender in the email app.

The command sends one test alert, subject to the hourly email limit.
The test reports use extension version `0.0.0`.

```sh
for report in 1 2 3; do
  curl --fail-with-body https://chatdinger.com/api/dinger-health \
    -H 'Content-Type: application/json' \
    --data '{"extensionVersion":"0.0.0","code":"controls_missing","selectorRevision":"deadbeef"}'
done
```

Each successful request returns HTTP 202. This confirms receipt, not email delivery.
The service tries again after one, two, and three minutes when email delivery has an error.
After these three retries, the service records an error and tries once each hour.
The service stops these retries when the report groups reach the 24-hour retention limit.

## Extension release

1. Publish the updated privacy notice on the website.
2. Update the Chrome Web Store privacy information for optional error reports.
3. Test extension version 2.0.22 in Chrome with a text response and an image response.
4. Test the sound with ChatGPT in a background tab.
5. Publish the extension package through the Chrome Web Store.

Existing open tabs can need one refresh after the extension update.
Later selector updates do not need a refresh.
Users of an older extension do not get the new automatic repair or error reports from a selector update alone.

## Limits

Reports contain three fields. They contain no chat text, page URL, email address, or installation identifier.
The service keeps report counts and up to three report times for each group.
It accepts up to 50 groups. If all groups have pending alerts, it rejects new groups with HTTP 503.
The edge rate limit uses the request IP address. The application does not copy that address into the report records.
The public endpoint has no client secret. Other clients can send false reports.
Origin checks, body limits, report validation, and rate limits reduce this risk.

Reports cover missing controls, uncertain completion, long responses, and sound playback errors from users who enable them.
Long response reports do not prove a detection error. ChatGPT can take more than 30 minutes to complete a response.
Reports do not prove that the user heard sound, or detect every future ChatGPT change.
No scheduled browser test is included in this service.

For a failure alert, use [SELECTOR_UPDATES.md](../../SELECTOR_UPDATES.md) to inspect and repair the controls.
The extension can apply a published repair. It cannot create a new repair from an unknown page layout.

## Local checks

1. Run `npm ci` from the repository root.
2. Run `npm run check`.

The tests cover report validation, rate limits, rolling thresholds, delayed alerts, email retries, and record removal.
They also cover service restarts, continuous reports, and full report storage.
The tests use a fake Email binding and do not send an email.
