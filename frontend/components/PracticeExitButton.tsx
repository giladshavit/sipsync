import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

// Floating top-left escape hatch for every screen in the practice-vs-bots
// flow — a translucent dark chip reads on top of any of those screens'
// backgrounds (loading screen, per-game accent colors, round-result colors),
// unlike the solid-border buttons used elsewhere that are tuned to one
// specific background.
export function PracticeExitButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        position: 'absolute',
        top: insets.top + 12,
        left: 16,
        zIndex: 10,
        width: 42,
        height: 42,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.6)',
        backgroundColor: 'rgba(10,10,15,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      className="active:opacity-70"
    >
      <ArrowLeft size={20} color="#FFFFFF" />
    </Pressable>
  );
}
