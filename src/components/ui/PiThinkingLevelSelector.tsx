import type { PiThinkingLevelSelection } from "@/aiParams";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSettingsValue } from "@/settings/model";
import { ChevronDown } from "lucide-react";
import React from "react";

interface PiThinkingLevelSelectorProps {
  disabled?: boolean;
  className?: string;
  value: PiThinkingLevelSelection;
  onChange: (value: PiThinkingLevelSelection) => void;
}

const PI_THINKING_LEVEL_OPTIONS: Array<{ label: string; value: PiThinkingLevelSelection }> = [
  { label: "Default", value: "default" },
  { label: "Off", value: "off" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra High", value: "xhigh" },
];

/**
 * Convert the active Pi thinking selection into a compact toolbar label.
 */
function getThinkingLabel(value: PiThinkingLevelSelection, defaultValue: string): string {
  if (value === "default") {
    return `Think: Default (${defaultValue})`;
  }

  if (value === "xhigh") {
    return "Think: XHigh";
  }

  return `Think: ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Pi-only dropdown for choosing the current chat thinking level.
 */
export function PiThinkingLevelSelector({
  disabled = false,
  className,
  value,
  onChange,
}: PiThinkingLevelSelectorProps) {
  const settings = useSettingsValue();
  const defaultThinkingLevel =
    settings.piAgent.thinkingLevel === "xhigh"
      ? "XHigh"
      : `${settings.piAgent.thinkingLevel.charAt(0).toUpperCase()}${settings.piAgent.thinkingLevel.slice(1)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          disabled={disabled}
          className={cn("tw-max-w-full tw-text-muted", className)}
        >
          <span className="tw-truncate">{getThinkingLabel(value, defaultThinkingLevel)}</span>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-5 tw-shrink-0" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="tw-max-h-64 tw-overflow-y-auto">
        {PI_THINKING_LEVEL_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <span className="tw-truncate">
              {option.label}
              {option.value === "default" ? ` (${defaultThinkingLevel} from settings)` : ""}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
