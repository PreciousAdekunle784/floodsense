import { Link } from '../App.jsx';
import { CLASS_HEX, CLASS_NAMES } from '../lib/format.js';
import { CLASS_ACTIONS, CLASS_MEANING, DURING, OFFICIAL_SOURCES } from '../lib/knowledge.js';

const BEFORE = [
  'Find out whether your home, school or workplace is in a High or Very-high susceptibility area — tap it on the FloodSense map.',
  'Keep drains and gutters clear; report blocked public drains to your local government.',
  'Prepare an emergency bag: copies of documents in waterproof bags, medicines, torch, power bank, drinking water, basic first aid.',
  'Agree with your household where you will go and how you will contact each other if you are separated.',
  'Store valuables, documents and electrical items off the floor in the rainy season (roughly April–October).',
];
const AFTER = [
  'Return home only when local authorities say it is safe.',
  'Photograph damage for records before cleaning up.',
  'Do not use electrical appliances that have been wet until checked.',
  'Boil or treat drinking water until supplies are confirmed safe; watch for signs of water-borne illness.',
  'Report what you saw on FloodSense — verified reports help others understand where flooding happens.',
];

export default function Prepare() {
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <p className="eyebrow">Module E · Preparedness</p>
            <h1>Prepare before the flood</h1>
            <p>General flood-safety guidance, and what each susceptibility class means for you. This is advice, not a warning: FloodSense does not forecast floods.</p>
          </div>
          <Link to="/" className="btn btn-accent">Check a location on the map</Link>
        </header>

        <div className="alert" style={{ marginBottom: 18 }}>
          <b>In an emergency call 112</b> (Nigeria’s national emergency number). For official flood warnings follow NIHSA, NiMet and Ogun State agencies — FloodSense does not issue warnings.
        </div>

        <div className="grid">
          <section className="card span-4"><h2>Before</h2><ul className="ticks">{BEFORE.map((x) => <li key={x}>{x}</li>)}</ul></section>
          <section className="card span-4"><h2>During</h2><ul className="ticks">{DURING.map((x) => <li key={x}>{x}</li>)}</ul></section>
          <section className="card span-4"><h2>After</h2><ul className="ticks">{AFTER.map((x) => <li key={x}>{x}</li>)}</ul></section>

          <section className="card span-12">
            <h2>What your location’s class means</h2>
            <p className="sub">Classes describe long-term terrain and drainage characteristics. They do not tell you whether it will flood today.</p>
            <div className="table-scroll">
              <table className="tbl">
                <thead><tr><th>Class</th><th>Meaning</th><th>Suggested preparedness</th></tr></thead>
                <tbody>
                  {[5, 4, 3, 2, 1].map((c) => (
                    <tr key={c}>
                      <td style={{ whiteSpace: 'nowrap' }}><span className="sw-inline" style={{ background: CLASS_HEX[c] }} /><b>{CLASS_NAMES[c]}</b></td>
                      <td>{CLASS_MEANING[c]}</td>
                      <td><ul className="ticks">{CLASS_ACTIONS[c].map((a) => <li key={a}>{a}</li>)}</ul></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card span-7">
            <h2>Where to get official information</h2>
            <p className="sub">FloodSense links to official sources by name only; it does not reproduce or invent their alerts, phone numbers or evacuation centres.</p>
            <table className="tbl"><tbody>{OFFICIAL_SOURCES.map((o) => <tr key={o.name}><td><b>{o.name}</b></td><td>{o.role}</td></tr>)}</tbody></table>
          </section>
          <section className="card span-5">
            <h2>How to read community reports</h2>
            <ul className="ticks">
              <li><b>Pending</b> reports are what someone says they saw. They have not been checked — treat them as a prompt to look for official information, not as confirmed facts.</li>
              <li><b>Verified</b> reports have been checked by a trained verifier against nearby reports, terrain and any photo.</li>
              <li>No reports in an area does <b>not</b> mean it is safe — it may simply mean nobody has reported yet.</li>
              <li>Reports show where flooding happened, not where it will happen next.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
