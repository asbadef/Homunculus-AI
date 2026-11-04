// Shared demo data shapes. Every screen reads these so a real endpoint can later
// return the same shape and swap in behind `transport`.

export type ResultType = "lab" | "radiology" | "pathology" | "epicrisis" | "document";
export type ResultStatus = "ready" | "pending";

export type ResultValue = {
  name: string;
  value: number;
  unit: string;
  refLow: number;
  refHigh: number;
  series?: number[]; // past values for the trend sparkline
};

export type Result = {
  id: string;
  type: ResultType;
  title: string;
  date: string;
  status: ResultStatus;
  protocol: string;
  hospital: string;
  doctor: string;
  values: ResultValue[];
  body?: string;       // epikriz / doküman metni (sayısal değer olmayan kayıtlar)
  userAdded?: boolean; // hasta tarafından eklenen doküman
};

export type Doctor = {
  id: string;
  name: string;
  specialty: string;
  departmentIds: string[]; // which departments this doctor serves
  favorite?: boolean;
  education: string[];
  experience: string[];
  memberships: string[];
  publications?: string[];
  nextSlot: string;
  times: string[];
};

export type Department = { id: string; name: string; icon: string };
export type Hospital = { id: string; name: string; distanceKm: number };

export type Drug = { barcode: string; usage: string; withFood: string; warnings: string[] };
export type Prescription = { id: string; name: string; date: string; drug: Drug };

export type Appointment = {
  id: string;
  doctor: string;
  specialty: string;
  date: string;
  time: string;
  hospital: string;
  status: "confirmed" | "pending" | "completed" | "cancelled";
};

export type Invoice = { id: string; title: string; amount: number; currency: string; status: "unpaid" | "paid"; date: string };
export type NewsItem = { id: string; title: string; summary: string; tint: string };
export type Story = { id: string; title: string; tint: string };
export type Banner = { id: string; title: string; subtitle: string; tint: string };
