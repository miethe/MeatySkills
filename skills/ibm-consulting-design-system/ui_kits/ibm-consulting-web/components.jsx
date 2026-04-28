// IBM Consulting Web UI Kit — all components in one file for portability.
// Loaded with <script type="text/babel" src="components.jsx">. Exports onto window.

const { useState } = React;

// --- Shared icon (simple arrow-right) ----------------------------------------
const ArrowRight = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M11.25 8 6 13.25l-.53-.53L10.19 8 5.47 3.28 6 2.75z"/>
  </svg>
);

// --- Masthead ----------------------------------------------------------------
function MastheadNav({ active = "Consulting", onNavigate }) {
  const items = ["Products", "Solutions", "Consulting", "Support", "Think"];
  return (
    <header className="ibm-masthead">
      <a className="ibm-masthead__brand" href="#" onClick={(e)=>{e.preventDefault(); onNavigate?.("home");}}>
        <img src="../../assets/logos/ibm-logo-white.png" alt="IBM" />
        <span className="sep">|</span>
        <span>Consulting</span>
      </a>
      <nav className="ibm-masthead__nav">
        {items.map((it) => (
          <a key={it} href="#" className={it === active ? "active" : ""}
             onClick={(e)=>{e.preventDefault();}}>
            {it}
          </a>
        ))}
      </nav>
      <div className="ibm-masthead__tools">
        <button aria-label="Search">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M15 14.3 10.7 10a5.5 5.5 0 1 0-.7.7L14.3 15zM2 6.5a4.5 4.5 0 1 1 4.5 4.5A4.51 4.51 0 0 1 2 6.5z"/></svg>
        </button>
        <button aria-label="Profile">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 8A3.5 3.5 0 1 0 4.5 4.5 3.5 3.5 0 0 0 8 8zm0-6a2.5 2.5 0 1 1-2.5 2.5A2.51 2.51 0 0 1 8 2zm6 14h-1v-1a5 5 0 0 0-10 0v1H2v-1a6 6 0 0 1 12 0z"/></svg>
        </button>
        <button className="cta" onClick={()=>onNavigate?.("contact")}>Contact</button>
      </div>
    </header>
  );
}

// --- Hero --------------------------------------------------------------------
function HeroBlock({ eyebrow, title, sub, ctaLabel = "Start your transformation", onCta }) {
  return (
    <section className="hero">
      <div className="hero__bg" style={{backgroundImage: "url(../../assets/backgrounds/ibm-sculpt-e-blue.jpg)"}} />
      <div className="hero__inner">
        <div className="hero__eyebrow">
          <span className="rule"></span>
          {eyebrow}
        </div>
        <h1 className="hero__title">{title}</h1>
        <p className="hero__sub">{sub}</p>
        <button className="ibm-btn ibm-btn--lg" onClick={onCta}>
          {ctaLabel}
          <ArrowRight />
        </button>
      </div>
    </section>
  );
}

// --- Button ------------------------------------------------------------------
function Button({ kind = "primary", size = "md", children, onClick, withArrow = true }) {
  const cls = ["ibm-btn"];
  if (kind === "secondary") cls.push("ibm-btn--secondary");
  if (kind === "tertiary")  cls.push("ibm-btn--tertiary");
  if (kind === "ghost")     cls.push("ibm-btn--ghost");
  if (size === "lg")        cls.push("ibm-btn--lg");
  return (
    <button className={cls.join(" ")} onClick={onClick}>
      {children}
      {withArrow && <ArrowRight />}
    </button>
  );
}

// --- Offering tile (battlecard thumbnail) ------------------------------------
function OfferingCard({ eyebrow, title, body, onClick }) {
  return (
    <div className="tile" onClick={onClick} tabIndex={0} role="button" onKeyDown={e=>{if(e.key==='Enter')onClick?.();}}>
      <div className="tile__eyebrow">{eyebrow}</div>
      <h3 className="tile__title">{title}</h3>
      <p className="tile__body">{body}</p>
      <span className="tile__arrow"><ArrowRight width="20" height="20"/></span>
    </div>
  );
}

// --- Stat block --------------------------------------------------------------
function StatBlock({ num, label, sub }) {
  return (
    <div className="stat">
      <div className="stat__num">{num}</div>
      <div className="stat__label">{label}</div>
      <div className="stat__sub">{sub}</div>
    </div>
  );
}

// --- TileLink ----------------------------------------------------------------
function TileLink({ eyebrow, children, onClick }) {
  return (
    <a className="tilelink" href="#" onClick={(e)=>{e.preventDefault(); onClick?.();}}>
      {eyebrow && <span className="tilelink__eyebrow">{eyebrow}</span>}
      {children}
    </a>
  );
}

// --- Footer ------------------------------------------------------------------
function FooterBar() {
  return (
    <footer className="ibm-footer">
      <div className="ibm-footer__grid">
        <div className="ibm-footer__col ibm-footer__brand">
          <img src="../../assets/logos/ibm-logo-white.png" alt="IBM" />
          <p style={{color:"#c6c6c6",fontSize:13,lineHeight:1.5,maxWidth:380,marginTop:24}}>
            IBM Consulting partners with enterprise leaders to design, build, and operate modern hybrid-cloud platforms.
          </p>
        </div>
        <div className="ibm-footer__col">
          <h4>Consulting</h4>
          <ul>
            <li><a href="#">Hybrid cloud</a></li>
            <li><a href="#">Automation</a></li>
            <li><a href="#">Data &amp; AI</a></li>
            <li><a href="#">Cybersecurity</a></li>
          </ul>
        </div>
        <div className="ibm-footer__col">
          <h4>Practices</h4>
          <ul>
            <li><a href="#">BoxBoat</a></li>
            <li><a href="#">Red Hat alliance</a></li>
            <li><a href="#">IBM Garage</a></li>
          </ul>
        </div>
        <div className="ibm-footer__col">
          <h4>Company</h4>
          <ul>
            <li><a href="#">About IBM</a></li>
            <li><a href="#">Investors</a></li>
            <li><a href="#">Careers</a></li>
          </ul>
        </div>
      </div>
      <div className="ibm-footer__bottom">
        <span>© IBM Corporation {new Date().getFullYear()}</span>
        <span>Privacy · Terms · Accessibility</span>
      </div>
    </footer>
  );
}

Object.assign(window, {
  ArrowRight, MastheadNav, HeroBlock, Button,
  OfferingCard, StatBlock, TileLink, FooterBar,
});
