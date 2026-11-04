import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as MailComposer from "expo-mail-composer";
import { Result } from "../demo/types";

function esc(s: unknown): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

// A simple, printable HTML for one result (patient + values + reference ranges).
export function buildResultHtml(r: Result, patientName: string): string {
  const rows = r.values
    .map((v) => {
      const abnormal = v.value < v.refLow || v.value > v.refHigh;
      const flag = abnormal ? "Aralıqdan kənar" : "Normal";
      const color = abnormal ? "#b45309" : "#047857";
      return `<tr>
        <td>${esc(v.name)}</td>
        <td style="text-align:right"><b>${esc(v.value)} ${esc(v.unit)}</b></td>
        <td style="text-align:right;color:#64748b">${esc(v.refLow)}–${esc(v.refHigh)}</td>
        <td style="text-align:right;color:${color}">${flag}</td>
      </tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8">
  <style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0f172a;padding:28px}
    h1{font-size:20px;margin:0 0 4px}
    .muted{color:#64748b;font-size:13px}
    .bar{height:4px;background:#0891b2;border-radius:4px;margin:14px 0}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
    th,td{padding:8px 6px;border-bottom:1px solid #e2e8f0}
    th{text-align:left;color:#64748b;font-weight:600;font-size:12px}
    .note{margin-top:18px;font-size:12px;color:#64748b}
  </style></head><body>
    <h1>${esc(r.title)}</h1>
    <div class="muted">${esc(patientName)} · ${esc(r.date)} · Protokol: ${esc(r.protocol)}</div>
    <div class="muted">${esc(r.hospital)} · ${esc(r.doctor)}</div>
    <div class="bar"></div>
    ${r.values.length ? `<table><thead><tr><th>Göstərici</th><th style="text-align:right">Nəticə</th><th style="text-align:right">Norma</th><th style="text-align:right">Status</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="muted">Bu nəticə üçün dəyər yoxdur.</div>`}
    <div class="note">Bu sənəd məlumat xarakterlidir və diaqnoz deyil. Dəqiq şərh üçün həkiminizlə danışın.</div>
  </body></html>`;
}

export async function exportResultPdf(r: Result, patientName: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildResultHtml(r, patientName) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: r.title, UTI: "com.adobe.pdf" });
  }
}

// Returns false when no mail client is available (caller can fall back to share).
export async function emailResult(r: Result, patientName: string, to: string): Promise<boolean> {
  const available = await MailComposer.isAvailableAsync();
  const { uri } = await Print.printToFileAsync({ html: buildResultHtml(r, patientName) });
  if (!available) {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    return false;
  }
  await MailComposer.composeAsync({
    recipients: to ? [to] : [],
    subject: `${r.title} — nəticə`,
    body: `${patientName}, ${r.title} (${r.date}) nəticəniz əlavədədir.`,
    attachments: [uri],
  });
  return true;
}
