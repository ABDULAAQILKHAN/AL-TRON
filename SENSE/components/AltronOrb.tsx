import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';

export type AltronOrbMode = 'idle' | 'listening' | 'speaking';

interface AltronOrbProps {
  mode: AltronOrbMode;
  size?: number;
  color?: string;
}

interface OrbNode {
  x: number;
  y: number;
  r: number;
}

const NODE_COUNT = 16;
const NEIGHBORS_PER_NODE = 2;

const SLOW_SPIN_MS = 16000;
const FAST_SPIN_MS = 2200;

const PULSE_MIN_SCALE = 0.82;
const PULSE_MAX_SCALE = 1.22;
const PULSE_MIN_MS = 260;
const PULSE_MAX_MS = 620;
const PULSE_SETTLE_MS = 300;

/** Sunflower/phyllotaxis distribution - even organic scatter within a circle, no clustering. */
function generateNodes(count: number, size: number): OrbNode[] {
  const center = size / 2;
  const maxRadius = size / 2 - 6;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const nodes: OrbNode[] = [];
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt(i / count) * maxRadius;
    const angle = i * goldenAngle;
    nodes.push({
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      r: 2 + Math.random() * 2,
    });
  }
  return nodes;
}

/** Connects each node to its N nearest neighbors, deduped, for a wireframe-mesh look. */
function generateEdges(nodes: OrbNode[], neighborsPerNode: number): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  nodes.forEach((node, i) => {
    const nearest = nodes
      .map((other, j) => ({ j, distance: i === j ? Infinity : Math.hypot(other.x - node.x, other.y - node.y) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, neighborsPerNode);

    nearest.forEach(({ j }) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(i < j ? [i, j] : [j, i]);
      }
    });
  });
  return edges;
}

function rotationDurationForMode(mode: AltronOrbMode): number {
  return mode === 'listening' ? FAST_SPIN_MS : SLOW_SPIN_MS;
}

/**
 * A JARVIS-style wireframe orb: small nodes connected by thin lines, spinning
 * continuously. Spin speed reflects `mode` (slow when idle, fast while
 * listening); while speaking it also pulses size randomly, layered on top of
 * whatever spin is already running.
 */
export default function AltronOrb({ mode, size = 140, color = '#FF8A00' }: AltronOrbProps) {
  const nodes = useMemo(() => generateNodes(NODE_COUNT, size), [size]);
  const edges = useMemo(() => generateEdges(nodes, NEIGHBORS_PER_NODE), [nodes]);

  const rotation = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const lapsRef = useRef(0);
  const rotationAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseActiveRef = useRef(false);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Continuous spin, restarted (not reset) whenever the target speed changes so it
  // never visibly snaps back to 0deg - the next lap just starts from wherever it is.
  useEffect(() => {
    const durationMs = rotationDurationForMode(mode);

    const runLap = () => {
      lapsRef.current += 1;
      const anim = Animated.timing(rotation, {
        toValue: lapsRef.current,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      rotationAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) runLap();
      });
    };

    runLap();
    return () => rotationAnimRef.current?.stop();
  }, [mode, rotation]);

  const runPulseLeg = useCallback(() => {
    if (!pulseActiveRef.current) return;
    const target = PULSE_MIN_SCALE + Math.random() * (PULSE_MAX_SCALE - PULSE_MIN_SCALE);
    const duration = PULSE_MIN_MS + Math.random() * (PULSE_MAX_MS - PULSE_MIN_MS);
    Animated.timing(scale, {
      toValue: target,
      duration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) runPulseLeg();
    });
  }, [scale]);

  useEffect(() => {
    if (mode === 'speaking') {
      pulseActiveRef.current = true;
      runPulseLeg();
    } else {
      pulseActiveRef.current = false;
      Animated.timing(scale, {
        toValue: 1,
        duration: PULSE_SETTLE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
    return () => {
      pulseActiveRef.current = false;
    };
  }, [mode, runPulseLeg, scale]);

  const center = size / 2;
  const coreRadius = size * 0.1;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={{ transform: [{ rotate: spin }, { scale }] }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id="core" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={color} stopOpacity={1} />
              <Stop offset="100%" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>

          {edges.map(([a, b], index) => (
            <Line
              key={`edge-${index}`}
              x1={nodes[a].x}
              y1={nodes[a].y}
              x2={nodes[b].x}
              y2={nodes[b].y}
              stroke={color}
              strokeWidth={1}
              strokeOpacity={0.35}
            />
          ))}

          <Circle cx={center} cy={center} r={coreRadius * 2.6} fill="url(#core)" />
          <Circle cx={center} cy={center} r={coreRadius} fill={color} opacity={0.95} />

          {nodes.map((node, index) => (
            <Circle key={`node-${index}`} cx={node.x} cy={node.y} r={node.r} fill={color} opacity={0.9} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
