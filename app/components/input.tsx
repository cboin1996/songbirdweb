import { forwardRef, HTMLInputTypeAttribute } from "react";

const Input = forwardRef<HTMLInputElement, {
    placeholder: string
    disabled?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    classAttrs?: string
    value?: string
    type?: HTMLInputTypeAttribute
    defaultValue?: string
    required?: boolean
}>(function Input({ placeholder, disabled, onChange, classAttrs, value, type, defaultValue, required }, ref) {
    return (
        <input
            ref={ref}
            type={type}
            required={required}
            className={`px-3 py-1.5 rounded-lg text-base md:text-sm bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 ${classAttrs ?? ''}`}
            placeholder={placeholder}
            disabled={disabled}
            onChange={onChange}
            value={value}
            defaultValue={defaultValue}
        />
    );
});

export default Input;
