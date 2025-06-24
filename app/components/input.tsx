import { HTMLInputTypeAttribute } from "react";

export default function Input({ placeholder, disabled, onChange, classAttrs, value, type, defaultValue }: { placeholder: string, disabled?: any, onChange?: any, classAttrs?: string, value?: any, type?: HTMLInputTypeAttribute, defaultValue?: any }) {
    return (
        <input
            type={type}
            className={`rounded-lg bg-gray-800 hover:outline hover:outline-sky-500 focus:outline invalid:outline-red-500 ${classAttrs}`}
            placeholder={placeholder}
            disabled={disabled}
            onChange={onChange}
            value={value}
            defaultValue={defaultValue}
        >
        </input>
    );
}
