import { Platform } from 'react-native';
import type { ComponentProps, ComponentType } from 'react';
import ExpoHead from 'expo-router/head';

// expo-router's <Head> exists for web SEO/social metadata, but on native it
// requires a configured handoff `origin` (expo-router config-plugin option)
// and THROWS without one — which crashes straight into the ErrorBoundary on
// a development build. The tags are meaningless off-web anyway, so native
// renders nothing. Import Head from here, never from 'expo-router/head'.
const Head: ComponentType<ComponentProps<typeof ExpoHead>> =
  Platform.OS === 'web' ? ExpoHead : () => null;

export default Head;
