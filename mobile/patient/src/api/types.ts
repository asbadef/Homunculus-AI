// Request/response shapes for the M1 (shared-backend) integration. These are the
// contract the HBYS bridge will fulfil; today the stub client in ./client returns
// demo values with the same shapes so screens are already wired.

export type BookingRequest = {
  patientFin: string;
  branchId: string;
  unitId: string; // HBYS birim id (pol/dax/cer/usq/kem/gun/ivf)
  doctorId: string;
  hospitalId: string | null;
  date: string;
  time: string;
  insurance: string;
};
export type BookingResult = {
  ok: boolean;
  appointmentId?: string;
  confirmSms?: boolean; // M1'de HBYS onay SMS'i gönderir
  message?: string;
};

export type PayRequest = { invoiceId: string; amount: number; currency: string };
export type PayResult = { ok: boolean; receiptId?: string; message?: string };

// Poliklinik sıra/çağrı: panelde H.data.sira[pid] / H.data.siraSon.
export type QueueStatus = { pid: string; myNumber: number | null; current: number | null };

// e-Reçete: barkod zaten var; M1'de eczanenin okuyabilirliği doğrulanır.
export type EPrescriptionStatus = { prescriptionId: string; barcode: string; pharmacyReadable: boolean };

// Online/video görüşme oturumu.
export type VideoSession = { appointmentId: string; joinUrl: string | null; ready: boolean };
