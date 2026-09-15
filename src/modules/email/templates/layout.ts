import { KREATE_LOGO_CID } from "./logo.js";

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
              <td style="padding:20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" valign="middle">
                      <img src="cid:${KREATE_LOGO_CID}" alt="Kreate" width="120" height="47" style="display:block;border:0;max-width:120px;height:auto;" />
                    </td>
                    <td align="right" valign="middle" style="color:#4c1d95;font-size:14px;font-weight:bold;white-space:nowrap;">
                      Career Counselling
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#27272a;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 32px;background-color:#fafafa;color:#71717a;font-size:12px;text-align:center;">
                &copy;<a href="https://designdestiny.org/" style="color:#71717a;text-decoration:underline;">Design Destiny</a>. All Rights Reserved.
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    <tr>
      <td style="background-color:#4c1d95;border-radius:6px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:40px;v-text-anchor:middle;width:220px;" arcsize="15%" stroke="f" fillcolor="#4c1d95">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">${label}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${href}" style="display:block;background-color:#4c1d95;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${label}</a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}
