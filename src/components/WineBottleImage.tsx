interface Props {
  name: string;
  producer: string;
  vintage: number;
  wineType: string;
  className?: string;
}

export default function WineBottleImage({ name, producer, vintage, wineType, className = '' }: Props) {
  const type = wineType.toLowerCase();
  const bottleColor = type.includes('white') ? '#2d4a1e' : type.includes('ros') ? '#3d1a2e' : '#1a0a0a';
  const labelBg = type.includes('white') ? '#fef9e7' : type.includes('ros') ? '#fce4ec' : '#f5f0e8';
  const labelAccent = type.includes('white') ? '#c8a84b' : type.includes('ros') ? '#ad4c6a' : '#8b0000';
  const foilColor = type.includes('white') ? '#c8a84b' : type.includes('ros') ? '#c06080' : '#8b1a1a';

  const shortName = name.length > 28 ? name.slice(0, 26) + '…' : name;
  const shortProducer = producer.length > 22 ? producer.slice(0, 20) + '…' : producer;

  return (
    <svg
      viewBox="0 0 160 400"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bottleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={bottleColor} stopOpacity="0.7" />
          <stop offset="40%" stopColor={bottleColor} stopOpacity="1" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor={bottleColor} stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="foilGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={foilColor} stopOpacity="0.8" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor={foilColor} stopOpacity="0.9" />
        </linearGradient>
        <clipPath id="bottleClip">
          <path d="
            M 68 15 L 68 60 Q 55 80 48 110 L 48 340 Q 48 360 80 360 Q 112 360 112 340 L 112 110 Q 105 80 92 60 L 92 15 Z
          " />
        </clipPath>
      </defs>

      {/* Bottle body */}
      <path
        d="M 68 15 L 68 60 Q 55 80 48 110 L 48 340 Q 48 360 80 360 Q 112 360 112 340 L 112 110 Q 105 80 92 60 L 92 15 Z"
        fill="url(#bottleGrad)"
      />

      {/* Glass highlight */}
      <path
        d="M 72 70 Q 66 90 63 115 L 63 300 Q 64 310 68 312 L 68 115 Q 71 90 74 70 Z"
        fill="white"
        opacity="0.06"
      />

      {/* Label background */}
      <rect x="50" y="140" width="60" height="130" rx="3" fill={labelBg} clipPath="url(#bottleClip)" />

      {/* Label top accent bar */}
      <rect x="50" y="140" width="60" height="8" rx="2" fill={labelAccent} clipPath="url(#bottleClip)" />

      {/* Label bottom accent bar */}
      <rect x="50" y="262" width="60" height="8" rx="2" fill={labelAccent} clipPath="url(#bottleClip)" />

      {/* Label border */}
      <rect x="50" y="140" width="60" height="130" rx="3" fill="none" stroke={labelAccent} strokeWidth="0.8" clipPath="url(#bottleClip)" />

      {/* Vintage year */}
      <text
        x="80"
        y="163"
        textAnchor="middle"
        fontFamily="serif"
        fontSize="12"
        fontWeight="bold"
        fill={labelAccent}
      >
        {vintage}
      </text>

      {/* Wine name */}
      <foreignObject x="53" y="168" width="54" height="54" clipPath="url(#bottleClip)">
        <div
          style={{
            fontSize: '6.5px',
            fontFamily: 'serif',
            color: '#1a1a1a',
            textAlign: 'center',
            lineHeight: '1.3',
            wordWrap: 'break-word',
            padding: '2px',
          }}
        >
          {shortName}
        </div>
      </foreignObject>

      {/* Producer */}
      <foreignObject x="52" y="228" width="56" height="30" clipPath="url(#bottleClip)">
        <div
          style={{
            fontSize: '5.5px',
            fontFamily: 'sans-serif',
            color: '#555',
            textAlign: 'center',
            lineHeight: '1.3',
            wordWrap: 'break-word',
          }}
        >
          {shortProducer}
        </div>
      </foreignObject>

      {/* Neck */}
      <rect x="68" y="15" width="24" height="50" rx="1" fill="url(#bottleGrad)" />

      {/* Foil capsule */}
      <path
        d="M 66 15 Q 66 8 80 5 Q 94 8 94 15 L 94 38 Q 94 42 80 42 Q 66 42 66 38 Z"
        fill="url(#foilGrad)"
      />

      {/* Foil highlight */}
      <path d="M 72 8 Q 73 6 78 5 L 78 40 Q 74 40 72 38 Z" fill="white" opacity="0.15" />

      {/* Cork top */}
      <ellipse cx="80" cy="5" rx="8" ry="3" fill="#d4a96a" />

      {/* Bottom base */}
      <ellipse cx="80" cy="340" rx="32" ry="8" fill={bottleColor} opacity="0.6" />
    </svg>
  );
}
