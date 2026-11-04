// M1 bridge client. While M1_ENABLED is false every method returns a demo result with
// the real shape, so the UI flow is complete today. When M1 lands, flip the flag in
// src/config/integration.ts and replace each TODO(M1) branch with the real HTTP call
// to the HBYS bridge — nothing else in the screens changes.
import { M1_ENABLED } from "../config/integration";
import type {
  BookingRequest, BookingResult, PayRequest, PayResult, QueueStatus, EPrescriptionStatus, VideoSession,
} from "./types";

const OFFLINE = "M1 ortak store qoşulmayıb — demo rejimi";

export const api = {
  // Randevu HBYS'ye düşer + onay SMS'i (M1). Demo modda yerelde onaylanır.
  async createBooking(req: BookingRequest): Promise<BookingResult> {
    if (!M1_ENABLED) return { ok: true, appointmentId: "demo-" + Date.now(), confirmSms: false, message: OFFLINE };
    // TODO(M1): POST `${API_BASE}/randevu` — HBYS birim: req.unitId; dönüşte appointmentId + SMS durumu
    throw new Error("M1 createBooking endpoint not wired");
  },

  // Fatura ödeme (M1 + ödeme sağlayıcı). Demo modda ödeme yok.
  async payInvoice(_req: PayRequest): Promise<PayResult> {
    if (!M1_ENABLED) return { ok: false, message: OFFLINE };
    // TODO(M1): POST `${API_BASE}/odeme` → makbuz id
    throw new Error("M1 payInvoice endpoint not wired");
  },

  // Poliklinik sıra numarası (panel: H.data.sira[pid] / H.data.siraSon).
  async getQueue(pid: string): Promise<QueueStatus> {
    if (!M1_ENABLED) return { pid, myNumber: null, current: null };
    // TODO(M1): GET `${API_BASE}/sira/${pid}`
    throw new Error("M1 getQueue endpoint not wired");
  },

  // e-Reçete eczane okunabilirliği.
  async getPrescriptionStatus(prescriptionId: string, barcode: string): Promise<EPrescriptionStatus> {
    if (!M1_ENABLED) return { prescriptionId, barcode, pharmacyReadable: false };
    // TODO(M1): GET `${API_BASE}/resept/${prescriptionId}`
    throw new Error("M1 getPrescriptionStatus endpoint not wired");
  },

  // Online görüşme oturumu.
  async getVideoSession(appointmentId: string): Promise<VideoSession> {
    if (!M1_ENABLED) return { appointmentId, joinUrl: null, ready: false };
    // TODO(M1): GET `${API_BASE}/gorusme/${appointmentId}`
    throw new Error("M1 getVideoSession endpoint not wired");
  },
};
