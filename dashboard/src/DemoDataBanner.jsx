// The board still draws its patients, alerts and vitals from the simulation: liveStore.js replaces
// only the authentication actions. Inside a hospital, a clinician who has just logged in with real
// credentials will reasonably read whatever follows as real, so the screen has to say plainly that
// it is not.
//
// Deliberately not dismissible, and deliberately its own file: ClinicalDemo.jsx is already ~4000
// lines. Phase 2 wires the live data layer, and this component is removed with it.

export function DemoDataBanner() {
  return (
    <div
      role="status"
      className="w-full bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      <span className="font-bold tracking-wide">ÖRNEK VERİ</span>
      {/* Telefonda uzun cümle dört satıra çıkıp ekranın altıda birini yiyordu. Uyarının kendisi
          küçülmüyor — yalnız açıklaması, okunacak yer kalmadığında geri çekiliyor. */}
      <span className="ml-2 hidden sm:inline">
        Bu ekrandaki hastalar, ölçümler ve alarmlar gösterim amaçlıdır — bu sunucunun canlı cihaz
        akışı değildir.
      </span>
      <span className="ml-2 sm:hidden">Gerçek hasta verisi değildir.</span>
    </div>
  );
}
