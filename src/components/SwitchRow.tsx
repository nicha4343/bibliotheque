import { useRef } from 'preact/hooks';

interface SwitchRowProps {
  label: string;
  detail?: string | undefined;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

let rowCount = 0;

/** A setting with its on/off switch, as on screen 7. */
export function SwitchRow({ label, detail, checked, disabled = false, onChange }: SwitchRowProps) {
  const id = useRef(`switch-${++rowCount}`).current;
  return (
    <div class="setting">
      <span class="setting__text">
        <span class="setting__label" id={`${id}-label`}>
          {label}
        </span>
        {detail && (
          <span class="setting__detail" id={`${id}-detail`}>
            {detail}
          </span>
        )}
      </span>
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={detail ? `${id}-detail` : undefined}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
      />
    </div>
  );
}
