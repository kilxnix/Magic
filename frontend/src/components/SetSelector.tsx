interface SetOption {
  code: string;
  name: string;
}

interface SetSelectorProps {
  sets: SetOption[];
  selectedSet: string;
  onSetChange: (setCode: string) => void;
  className?: string;
}

export function SetSelector({ sets, selectedSet, onSetChange, className = '' }: SetSelectorProps) {
  return (
    <select
      value={selectedSet}
      onChange={(e) => onSetChange(e.target.value)}
      className={`px-3 py-1.5 text-sm border border-stone-300 rounded-md bg-white text-stone-700 focus:ring-stone-500 focus:border-stone-500 ${className}`}
    >
      {sets.map((set) => (
        <option key={set.code} value={set.code}>
          {set.name}
        </option>
      ))}
    </select>
  );
}
