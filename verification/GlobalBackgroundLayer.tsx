import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";

export interface GlobalBackgroundLayerProps {
  source: ImageSourcePropType;
  opacity: number;
  blurRadius?: number;
}

// Portable host-side building block, not an existing Paseo contribution API.
// Mount before app chrome under a positioned root. Its sibling surfaces must
// explicitly support transparent backgrounds, including navigator backdrops.
export function GlobalBackgroundLayer({
  source,
  opacity,
  blurRadius = 0,
}: GlobalBackgroundLayerProps) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      <Image
        accessible={false}
        source={source}
        resizeMode="cover"
        blurRadius={blurRadius}
        style={[StyleSheet.absoluteFill, { opacity }]}
      />
    </View>
  );
}
