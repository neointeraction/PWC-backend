// Shared HTML shell so every template gets consistent, email-client-safe styling
// without repeating the boilerplate in each template file.
export function renderLayout(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#4c1d95;padding:20px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:bold;">kREATE Career Counselling</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#27272a;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#fafafa;color:#71717a;font-size:12px;">
                Team kREATE | Design Destiny
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;">${text}</p>`;
}

export function heading(text: string): string {
  return `<h2 style="margin:0 0 12px;font-size:17px;color:#18181b;">${text}</h2>`;
}

export function button(label: string, href: string): string {
  return `<p style="margin:0 0 16px;"><a href="${href}" style="display:inline-block;background-color:#4c1d95;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:bold;">${label}</a></p>`;
}
