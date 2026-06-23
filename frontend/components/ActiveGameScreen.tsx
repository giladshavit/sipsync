import React from 'react';
import { View, Text } from 'react-native';
import { ReflexGameUI } from './games/ReflexGameUI';

export interface MiniGameProps {
  gameState: Record<string, unknown>;
  onAction: (action: string, payload?: Record<string, unknown>) => void;
}

const GAME_REGISTRY: Record<string, React.FC<MiniGameProps>> = {
  red_light_green_light: ReflexGameUI,
  // Drop future games here — no other file changes needed.
};

interface Props {
  gameId: string | null;
  gameState?: Record<string, unknown>;
  onAction?: MiniGameProps['onAction'];
}

export function ActiveGameScreen({ gameId, gameState = {}, onAction = () => {} }: Props) {
  if (!gameId) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-slate-500">No active game</Text>
      </View>
    );
  }

  const GameComponent = GAME_REGISTRY[gameId];
  if (!GameComponent) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-red-400">Unknown game: {gameId}</Text>
      </View>
    );
  }

  return <GameComponent gameState={gameState} onAction={onAction} />;
}
