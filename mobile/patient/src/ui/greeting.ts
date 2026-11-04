// Time-aware greeting key (morning / afternoon / evening). Pure so it can be unit-tested.
export function greetKey(date: Date = new Date()): "greet.morning" | "greet.afternoon" | "greet.evening" {
  const h = date.getHours();
  if (h < 12) return "greet.morning";
  if (h < 18) return "greet.afternoon";
  return "greet.evening";
}
