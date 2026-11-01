// Test-only: synthetic monitors and list bodies for the monitor→bed editor (GET
// /infinity-shadow/device-beds, homunculus-engine devicebeds/listing.py), on kabul.testutil's ward.
import { BED, mountKabul } from "../kabul/kabul.testutil.js";

export const MAP = Object.freeze(["devices.map_beds", "board.view"]);   // a charge nurse's two that matter here
export const BIO = Object.freeze(["devices.manage"]);                    // biomedical: reads, binds nothing

export function device(source, over = {}) {
  return { source, group: `224.0.2.${source.split(".").pop()}`, port: 2050, device_bed_label: null,
    seen: true, status: "streaming", last_seen_at: "2026-10-30T09:12:01.400000+00:00", row_id: null,
    bed: null, editable: true, ...over };
}

export const onBed = (n, label, room = "Otaq 1", unit = "Reanimasiya") => ({ id: BED(n), in_scope: true, label, room, unit });

export function list(devices, over = {}) {
  return { stage: "shadow", generated_at: "2026-10-30T09:12:03.120000+00:00", can_bind: true, devices, ...over };
}

/** `ui` in the shell's providers (structure included), the list answering `body`. */
export function mountMapping(ui, { perms = MAP, body = list([]), setup } = {}) {
  return mountKabul(ui, { perms, setup: (api) => { api.deviceBeds.mockResolvedValue(body); setup?.(api); } });
}
