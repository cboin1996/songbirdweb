import { HTMLInputTypeAttribute } from "react";

export default function Input({ placeholder, disabled, onChange, width, value, type }: { placeholder: string, disabled: any, onChange?: any, width?: number, value?: any, type?: HTMLInputTypeAttribute }) {
    return (
        <input
            type={type}
            className={`rounded-lg bg-gray-800 hover:outline hover:outline-sky-500 focus:outline w-${width} invalid:outline-red-500`}
            placeholder={placeholder}
            disabled={disabled}
            onChange={onChange}
            value={value}
        >
        </input>
    );
}
