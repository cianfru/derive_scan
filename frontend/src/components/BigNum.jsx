// Display numbers on the home cards: one formatted figure ("+$10.05M", "+12.4%", "26%") set in the mono
// face with its sign, currency and unit smaller than the digits and the decimal point drawn tight (the
// mono cell leaves a wide gap around "."). Anything else, a word or a name, renders as given.
const NUM = /^([+−-]?)(\$?)([\d,]+)(?:\.(\d+))?([%KMB]?)$/;

export default function BigNum({ text, className = "" }) {
  const m = NUM.exec(text);
  return (
    <span className={`bn${className ? ` ${className}` : ""}`}>
      {m ? <>
        {m[1] && <span className="bn-sign">{m[1]}</span>}
        {m[2] && <span className="bn-cur">$</span>}
        {m[3]}
        {m[4] != null && <><span className="bn-dot">.</span>{m[4]}</>}
        {m[5] && <span className="bn-unit">{m[5]}</span>}
      </> : text}
    </span>
  );
}
