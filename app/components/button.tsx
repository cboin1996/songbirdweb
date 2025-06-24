export default function Button({ text, onClick, disabled }: { text?: string, onClick?: any, disabled?: any }) {
    return (
        <button className="dark:bg-white bg-gray-200 rounded-lg text-black hover:bg-sky-600 px-3 disabled:bg-gray-200 dark:disabled:bg-gray-800" disabled={disabled} onClick={onClick}>{text}</button>
    );
}
