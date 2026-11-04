// Mock transport: async getters over the demo db. Every screen calls these, so a
// real API can later replace this module without touching the screens.
import * as db from "./db";
import { Appointment, Banner, Department, Doctor, Hospital, Invoice, NewsItem, Prescription, Result, Story } from "./types";

const give = <T>(v: T): Promise<T> => Promise.resolve(v);

export const transport = {
  getHospitals: (): Promise<Hospital[]> => give(db.hospitals),
  getDepartments: (): Promise<Department[]> => give(db.departments),
  getDoctors: (): Promise<Doctor[]> => give(db.doctors),
  getResults: (): Promise<Result[]> => give(db.results),
  getPrescriptions: (): Promise<Prescription[]> => give(db.prescriptions),
  getAppointments: (): Promise<Appointment[]> => give(db.appointments),
  getInvoices: (): Promise<Invoice[]> => give(db.invoices),
  getNews: (): Promise<NewsItem[]> => give(db.news),
  getStories: (): Promise<Story[]> => give(db.stories),
  getBanners: (): Promise<Banner[]> => give(db.banners),
};
