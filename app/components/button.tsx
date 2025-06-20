export default function Button({ text, onClick, disabled }: { text?: string, onClick?: any, disabled?: any }) {
    return (
        <button className="bg-white rounded-lg text-black hover:bg-sky-600 px-3 disabled:bg-gray-800" disabled={disabled} onClick={onClick}>{text}</button>
    );
}
