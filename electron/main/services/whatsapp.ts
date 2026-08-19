import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { buildMessage, normaliseMobile } from '../../../shared/whatsapp';
import type { Invoice, WhatsAppSettings } from '../../../shared/types';
import { getSettings } from '../db/settings';
import { exportInvoicePdf, revealPath } from './documents';

const GRAPH_VERSION = 'v21.0';

export { buildMessage, normaliseMobile };

async function graphRequest(url: string, token: string, body: FormData | string, isJson: boolean) {
  const response = await fetch(url, {
    method: 'POST',
    headers: isJson
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${token}` },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // Keep the raw body when the API returns a non-JSON error page.
    }
    throw new Error(`WhatsApp API error (${response.status}): ${detail}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

/** Uploads the PDF to WhatsApp and sends it as a document message. */
async function sendViaCloudApi(
  settings: WhatsAppSettings,
  recipient: string,
  filePath: string,
  caption: string,
): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append(
    'file',
    new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' }),
    path.basename(filePath),
  );

  const upload = await graphRequest(
    `https://graph.facebook.com/${GRAPH_VERSION}/${settings.phoneNumberId}/media`,
    settings.accessToken,
    form,
    false,
  );

  const mediaId = upload.id;
  if (typeof mediaId !== 'string') {
    throw new Error('WhatsApp did not return a media id for the uploaded invoice.');
  }

  await graphRequest(
    `https://graph.facebook.com/${GRAPH_VERSION}/${settings.phoneNumberId}/messages`,
    settings.accessToken,
    JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'document',
      document: { id: mediaId, filename: path.basename(filePath), caption },
    }),
    true,
  );
}

export interface ShareResult {
  mode: 'cloud-api' | 'deep-link';
  filePath: string;
  message: string;
}

/**
 * Shares the invoice PDF over WhatsApp.
 *
 * With the Cloud API configured the document is delivered directly. Otherwise —
 * and whenever the API call fails — the PDF is still produced, WhatsApp opens on
 * the customer's chat with the message pre-filled, and the file is revealed in
 * the file manager ready to attach. Sharing never leaves the shop without a PDF.
 */
export async function shareInvoiceOnWhatsApp(invoice: Invoice): Promise<ShareResult> {
  const { shop, whatsapp } = getSettings();
  const filePath = await exportInvoicePdf(invoice);
  const message = buildMessage(invoice, whatsapp.messageTemplate, shop.shopName);
  const recipient = normaliseMobile(invoice.customerMobile, whatsapp.defaultCountryCode);

  if (whatsapp.useCloudApi && whatsapp.phoneNumberId && whatsapp.accessToken) {
    if (!recipient) {
      throw new Error('Add the customer mobile number before sending on WhatsApp.');
    }
    await sendViaCloudApi(whatsapp, recipient, filePath, message);
    return { mode: 'cloud-api', filePath, message };
  }

  const url = recipient
    ? `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  await shell.openExternal(url);
  revealPath(filePath);
  return { mode: 'deep-link', filePath, message };
}
