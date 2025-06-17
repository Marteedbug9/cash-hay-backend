// src/types/expo-camera.d.ts
import { Camera } from 'expo-camera';

// Tu ajoutes ce type globalement pour faciliter l'import dans ton code
declare global {
  type ExpoCameraType = Camera;
}
