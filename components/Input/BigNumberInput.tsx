import * as React from "react";
import { formatUnits, parseUnits } from "@ethersproject/units";
import { BigNumber } from "@ethersproject/bignumber";

export type BigNumberInputProps = {
	decimals: number;
	value: string;
	onChange: (value: string) => void;
	renderInput?: (props: React.HTMLProps<HTMLInputElement>) => React.ReactElement;
	autofocus?: boolean;
	placeholder?: string;
	max?: string;
	min?: string;
	className?: string;
	disabled?: boolean;
	onFocus?: () => void;
	onBlur?: () => void;
	hideTrailingZeros?: boolean;
	displayDecimals?: number;
};

export function BigNumberInput({
	decimals,
	value,
	onChange,
	renderInput,
	autofocus,
	placeholder = "0.00",
	max,
	min,
	className,
	disabled,
	onFocus,
	onBlur,
	hideTrailingZeros,
	displayDecimals,
}: BigNumberInputProps) {
	const inputRef = React.useRef<any>(null);
	const inputValueRef = React.useRef("");

	const [inputValue, setInputvalue] = React.useState("");

	// Keep ref in sync so the effect below can read the latest inputValue without depending on it
	inputValueRef.current = inputValue;

	// Sync external value prop → local inputValue. Must NOT depend on inputValue
	// to avoid overwriting user keystrokes mid-typing.
	React.useEffect(() => {
		if (!value) {
			setInputvalue("");
		} else {
			let parseInputValue;

			try {
				parseInputValue = parseUnits(inputValueRef.current || "0", decimals);
			} catch {
				// do nothing
			}

			if (!parseInputValue || !parseInputValue.eq(value)) {
				let formatted = formatUnits(value, decimals);
				if (displayDecimals !== undefined) {
					const dotIdx = formatted.indexOf(".");
					if (dotIdx !== -1 && formatted.length - dotIdx - 1 > displayDecimals) {
						formatted = formatted.slice(0, dotIdx + displayDecimals + 1);
					}
				}
				if (hideTrailingZeros) {
					formatted = formatted.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
				}
				setInputvalue(formatted);
			}
		}
	}, [value, decimals, hideTrailingZeros, displayDecimals]);

	React.useEffect(() => {
		if (!renderInput && autofocus && inputRef) {
			const node = inputRef.current as HTMLInputElement;
			node.focus();
		}
	}, [autofocus, inputRef, renderInput]);

	const updateValue = (event: React.ChangeEvent<HTMLInputElement>) => {
		const { value } = event.currentTarget;

		if (value === "") {
			onChange(value);
			setInputvalue(value);
			return;
		}

		let newValue: BigNumber;
		try {
			newValue = parseUnits(value, decimals);
		} catch (e) {
			// don't update the input on invalid values
			return;
		}

		const invalidValue = (min && newValue.lt(min)) || (max && newValue.gt(max));
		if (invalidValue) {
			return;
		}

		setInputvalue(value);
		onChange(newValue.toString());
	};

	const inputProps = {
		placeholder,
		onChange: updateValue,
		type: "text",
		value: inputValue,
		className: `${className} ${disabled ? "text-slate-400" : ""}`,
		onFocus,
		onBlur,
	};

	return renderInput ? renderInput({ ...inputProps }) : <input {...inputProps} ref={inputRef} disabled={disabled} />;
}
