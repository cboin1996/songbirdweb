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
            className={`rounded-lg dark:bg-gray-800 bg-gray-200 hover:outline hover:outline-sky-500 focus:outline invalid:outline-red-500 ${classAttrs}`}
            placeholder={placeholder}
            disabled={disabled}
            onChange={onChange}
            value={value}
            defaultValue={defaultValue}
        />
    );
});

export default Input;
