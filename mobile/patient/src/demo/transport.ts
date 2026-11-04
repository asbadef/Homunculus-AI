// Mock transport: async getters over the demo db. Every screen calls these, so a
// real API can later replace this module without touching the screens.
import * as db from "./db";
import { currentPatient } from "./patients";
import { Appointment, Banner, Department, Doctor, Hospital, Invoice, NewsItem, Prescription, Result, Story } from "./types";

const give = <T>(v: T): Promise<T> => Promise.resolve(v);

export const transport = {
  // Shared directory (same for everyone).
  getHospitals: (): Promise<Hospital[]> => give(db.hospitals),
  getDepartments: (): Promise<Department[]> => give(db.departments),
  getDoctors: (): Promise<Doctor[]> => give(db.doctors),
  getNews: (): Promise<NewsItem[]> => give(db.news),
  getStories: (): Promise<Story[]> => give(db.stories),
  getBanners: (): Promise<Banner[]> => give(db.banners),
  // Scoped to the signed-in (current) patient.
  getResults: (): Promise<Result[]> => give(currentPatient().results),
  getPrescriptions: (): Promise<Prescription[]> => give(currentPatient().prescriptions),
  getAppointments: (): Promise<Appointment[]> => give(currentPatient().appointments),
  getInvoices: (): Promise<Invoice[]> => give(currentPatient().invoices),
};
