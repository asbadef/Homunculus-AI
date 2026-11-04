// Thin wrapper over expo-image-picker. Returns the picked image URI, or null if the
// user cancelled or denied permission. Works on device and on web (file dialog).
import * as ImagePicker from "expo-image-picker";

export async function pickImage(square = false): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") return null;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      allowsEditing: square,
      aspect: square ? [1, 1] : undefined,
    });
    if (res.canceled || !res.assets || !res.assets[0]) return null;
    return res.assets[0].uri;
  } catch {
    return null;
  }
}
