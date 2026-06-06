import React, { useState, useEffect } from 'react';
import { 
  Heart, Users, BarChart2, Shield, Calendar, Activity, 
  Mail, Send, CheckCircle, AlertTriangle, HelpCircle, 
  MapPin, Clock, Award, Check, X, RefreshCw, ChevronRight,
  BookOpen, Plus, Minus, UserCheck, ShieldAlert
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';

const API_BASE = 'http://localhost:8000';

function App() {
  const [activeRole, setActiveRole] = useState('coordinator'); // coordinator, management, donor, patient, hospital, community
  const [donors, setDonors] = useState([]);
  const [requests, setRequests] = useState([]);
  const [emails, setEmails] = useState([]);
  const [selectedDonor, setSelectedDonor] = useState(null);
  
  // Form states
  const [patientId, setPatientId] = useState('PAT_129');
  const [bloodGroup, setBloodGroup] = useState('O Positive');
  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState('Emergency');
  
  // Simulation states
  const [activeEmail, setActiveEmail] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState(null);
  
  // Management Analytics stats
  const [stats, setStats] = useState({
    kpis: { total_donors: 0, eligible_donors: 0, active_bridges: 0, avg_response_minutes: 0, conversion_rate_percent: 0 },
    forecast: [],
    churn_risks: [],
    ai_ledger: []
  });

  // Inventory stats
  const [inventory, setInventory] = useState([]);

  // Selected donor state in Donor Portal (we will use a seeded user from DB)
  const [currentDonorId, setCurrentDonorId] = useState('');
  const [currentDonor, setCurrentDonor] = useState(null);

  // Questionnaire for eligibility checker
  const [questionnaire, setQuestionnaire] = useState({
    age: true,
    weight: true,
    tattoo: false,
    illness: false
  });

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000); // Poll every 8 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      // Donors
      const resDonors = await fetch(`${API_BASE}/api/donors`);
      const dataDonors = await resDonors.json();
      setDonors(dataDonors);
      if (dataDonors.length > 0 && !currentDonorId) {
        // Set a default donor for Donor Portal
        setCurrentDonorId(dataDonors[0].user_id);
        fetchDonorProfile(dataDonors[0].user_id);
      }

      // Requests
      const resReqs = await fetch(`${API_BASE}/api/requests`);
      const dataReqs = await resReqs.json();
      setRequests(dataReqs);

      // Emails
      const resEmails = await fetch(`${API_BASE}/api/outreach/emails`);
      const dataEmails = await resEmails.json();
      // Sort emails showing newest first
      setEmails(dataEmails.reverse());

      // Stats
      const resStats = await fetch(`${API_BASE}/api/management/stats`);
      const dataStats = await resStats.json();
      setStats(dataStats);

      // Inventory
      const resInv = await fetch(`${API_BASE}/api/hospitals/inventory`);
      const dataInv = await resInv.json();
      setInventory(dataInv);

    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  const fetchDonorProfile = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/donors/${id}`);
      const data = await res.json();
      setCurrentDonor(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdatePreferences = async (donorId, language, consent, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/donors/${donorId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, consent, user_donation_active_status: status })
      });
      if (res.ok) {
        fetchDonorProfile(donorId);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          blood_group: bloodGroup,
          quantity: parseFloat(quantity),
          priority,
          latitude: HYDERABAD_CENTERS[0].lat + (Math.random() - 0.5) * 0.05,
          longitude: HYDERABAD_CENTERS[0].lon + (Math.random() - 0.5) * 0.05
        })
      });
      if (res.ok) {
        setPatientId(`PAT_${Math.floor(Math.random() * 1000)}`);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleForceEscalate = async (reqId) => {
    try {
      await fetch(`${API_BASE}/api/requests/${reqId}/force-escalate`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCompleteDonation = async (reqId) => {
    try {
      const res = await fetch(`${API_BASE}/api/requests/${reqId}/complete`, { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateInventory = async (bg, offset) => {
    const current = inventory.find(i => i.blood_group === bg)?.units || 0;
    try {
      await fetch(`${API_BASE}/api/hospitals/inventory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blood_group: bg, units: Math.max(0, current + offset) })
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendEmailReply = async () => {
    if (!activeEmail || !replyText.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/outreach/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: activeEmail.subject.includes("Blood Donation Needed") ? activeEmail.subject.split("-")[0].replace("URGENT: Blood Donation Needed", "").trim() : "req_test",
          // Wait, extract the request_id if email has action links, else mock
          donor_id: activeEmail.to.split("@")[0] + "02a7155dc39f85533066c003b37527689da0b4f6a450366f1ba4".substring(0, 16), 
          // Let's parse donor_id from the logs or use the default seeded donor
          reply_text: replyText
        })
      });
      const data = await res.json();
      setAiAnalysis(data.ai_analysis);
      setReplyText('');
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEmailActionClick = async (reqId, donorId, action) => {
    try {
      const res = await fetch(`${API_BASE}/api/outreach/respond?request_id=${reqId}&donor_id=${donorId}&action=${action}`);
      const data = await res.json();
      alert(data.message);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Coordinates of Blood Bank Centers in Hyderabad for our interactive SVG Map
  const HYDERABAD_CENTERS = [
    { name: "Central Hyderabad Red Cross", lat: 17.3850, lon: 78.4867, type: "hospital" },
    { name: "Deccan Thalassemia Care", lat: 17.4062, lon: 78.4842, type: "hospital" },
    { name: "Jubilee Hills Blood Bridge", lat: 17.4325, lon: 78.4071, type: "hospital" },
    { name: "Secunderabad Area Bank", lat: 17.4411, lon: 78.5011, type: "hospital" }
  ];

  // Helper to project coordinates onto a 1000x500 SVG viewBox
  const projectCoords = (lat, lon) => {
    // Latitude range: approx 17.35 to 17.46
    // Longitude range: approx 78.38 to 78.52
    const minLat = 17.35, maxLat = 17.46;
    const minLon = 78.38, maxLon = 78.52;
    
    const x = ((lon - minLon) / (maxLon - minLon)) * 900 + 50;
    const y = 450 - ((lat - minLat) / (maxLat - minLat)) * 400 + 25; // Flip Y for screen coords
    return { x, y };
  };

  return (
    <div className="app-container">
      {/* 1. Sidebar */}
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '30px' }}>
          <Heart size={28} color="#d61c2e" fill="#d61c2e" className="pulse-glow" style={{ animationDuration: '3s' }} />
          <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--font-title)', background: 'linear-gradient(to right, #ffffff, #ff6b7b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            BondOfLife
          </h2>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <button 
            id="btn-nav-coordinator"
            className={`btn-secondary ${activeRole === 'coordinator' ? 'active-nav' : ''}`} 
            onClick={() => setActiveRole('coordinator')}
            style={{ justifyContent: 'flex-start', background: activeRole === 'coordinator' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'coordinator' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <Activity size={18} color={activeRole === 'coordinator' ? 'var(--color-accent-red)' : '#8f909d'} />
            Command Center
          </button>
          
          <button 
            id="btn-nav-management"
            className={`btn-secondary ${activeRole === 'management' ? 'active-nav' : ''}`} 
            onClick={() => setActiveRole('management')}
            style={{ justifyContent: 'flex-start', background: activeRole === 'management' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'management' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <BarChart2 size={18} color={activeRole === 'management' ? 'var(--color-accent-red)' : '#8f909d'} />
            Management Stats
          </button>

          <button 
            id="btn-nav-donor"
            className={`btn-secondary ${activeRole === 'donor' ? 'active-nav' : ''}`} 
            onClick={() => {
              setActiveRole('donor');
              if (currentDonorId) fetchDonorProfile(currentDonorId);
            }}
            style={{ justifyContent: 'flex-start', background: activeRole === 'donor' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'donor' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <Users size={18} color={activeRole === 'donor' ? 'var(--color-accent-red)' : '#8f909d'} />
            Donor Portal
          </button>

          <button 
            id="btn-nav-patient"
            className={`btn-secondary ${activeRole === 'patient' ? 'active-nav' : ''}`} 
            onClick={() => setActiveRole('patient')}
            style={{ justifyContent: 'flex-start', background: activeRole === 'patient' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'patient' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <UserCheck size={18} color={activeRole === 'patient' ? 'var(--color-accent-red)' : '#8f909d'} />
            Patient Portal
          </button>

          <button 
            id="btn-nav-hospital"
            className={`btn-secondary ${activeRole === 'hospital' ? 'active-nav' : ''}`} 
            onClick={() => setActiveRole('hospital')}
            style={{ justifyContent: 'flex-start', background: activeRole === 'hospital' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'hospital' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <Calendar size={18} color={activeRole === 'hospital' ? 'var(--color-accent-red)' : '#8f909d'} />
            Hospital Partner
          </button>

          <button 
            id="btn-nav-community"
            className={`btn-secondary ${activeRole === 'community' ? 'active-nav' : ''}`} 
            onClick={() => setActiveRole('community')}
            style={{ justifyContent: 'flex-start', background: activeRole === 'community' ? 'rgba(214, 28, 46, 0.15)' : 'transparent', borderColor: activeRole === 'community' ? 'var(--color-primary-red)' : 'transparent' }}
          >
            <BookOpen size={18} color={activeRole === 'community' ? 'var(--color-accent-red)' : '#8f909d'} />
            Community Page
          </button>
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-glass)', paddingTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
            <div className="dot" style={{ background: 'var(--color-success)', width: '8px', height: '8px' }}></div>
            <span>AWS Cloud Sandbox Connected</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-dark)' }}>
            Model: Claude 3 Haiku (Bedrock)
          </div>
        </div>
      </aside>

      {/* 2. Main Content & Analytics */}
      <main className="main-content" style={{ display: 'flex', gap: '25px', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '25px' }}>
          {/* Header */}
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ textTransform: 'uppercase', fontSize: '11px', color: 'var(--color-primary-red)', fontWeight: '700', letterSpacing: '0.1em' }}>
                Role-Based View / {activeRole}
              </span>
              <h1 style={{ fontSize: '26px', color: 'white', marginTop: '4px' }}>
                {activeRole === 'coordinator' && "Coordinator Command Centre"}
                {activeRole === 'management' && "Management Analytics Dashboard"}
                {activeRole === 'donor' && "Donor Impact & Settings"}
                {activeRole === 'patient' && "Patient Care Tracker"}
                {activeRole === 'hospital' && "Hospital Partner Operations"}
                {activeRole === 'community' && "Community Awareness & Education"}
              </h1>
            </div>
            <button 
              id="btn-refresh-data"
              className="btn-secondary" 
              onClick={fetchData} 
              style={{ padding: '8px 12px', fontSize: '13px' }}
            >
              <RefreshCw size={14} />
              Sync Data
            </button>
          </header>

          {/* Views switch-case */}
          
          {/* A. Coordinator Command Centre */}
          {activeRole === 'coordinator' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              {/* Map container */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={18} color="var(--color-primary-red)" />
                  Live Blood Bridge Locator Map (Hyderabad Center)
                </h3>
                <div style={{ background: '#08080c', border: '1px solid var(--border-glass)', borderRadius: '10px', height: '400px', width: '100%', position: 'relative' }}>
                  {/* Visual Map Render using SVG */}
                  <svg viewBox="0 0 1000 500" style={{ width: '100%', height: '100%' }}>
                    {/* Grid Lines representing map coordinates */}
                    <defs>
                      <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#map-grid)" />
                    
                    {/* Stylized Hyderabad Lakes / Outer ring outline */}
                    <circle cx="500" cy="250" r="230" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="2" strokeDasharray="5,5" />
                    <circle cx="500" cy="250" r="120" fill="none" stroke="rgba(214, 28, 46, 0.03)" strokeWidth="1" />
                    
                    {/* Draw active lines between patients and matches */}
                    {requests.map(req => {
                      if (req.status !== 'MATCHING' && req.status !== 'CONFIRMED') return null;
                      const patProj = projectCoords(req.latitude, req.longitude);
                      
                      // Find matching donors coordinates
                      return (req.waves[req.current_wave - 1] || []).map(donorId => {
                        const donor = donors.find(d => d.user_id === donorId);
                        if (!donor) return null;
                        const donProj = projectCoords(donor.latitude, donor.longitude);
                        return (
                          <line 
                            key={`${req.request_id}-${donorId}`}
                            x1={patProj.x} y1={patProj.y}
                            x2={donProj.x} y2={donProj.y}
                            stroke={req.status === 'CONFIRMED' ? 'var(--color-success)' : 'rgba(214, 28, 46, 0.3)'}
                            strokeWidth="1.5"
                            strokeDasharray={req.status === 'CONFIRMED' ? 'none' : '4,4'}
                          />
                        );
                      });
                    })}

                    {/* Plot Hospital Centers */}
                    {HYDERABAD_CENTERS.map((h, i) => {
                      const proj = projectCoords(h.lat, h.lon);
                      return (
                        <g key={`hosp-${i}`}>
                          <rect x={proj.x - 8} y={proj.y - 8} width="16" height="16" fill="var(--color-info)" opacity="0.3" rx="4" />
                          <circle cx={proj.x} cy={proj.y} r="5" fill="var(--color-info)" />
                          <text x={proj.x + 10} y={proj.y + 4} fill="var(--color-text-muted)" fontSize="9" fontWeight="bold">
                            {h.name}
                          </text>
                        </g>
                      );
                    })}

                    {/* Plot Donors */}
                    {donors.map(d => {
                      const proj = projectCoords(d.latitude, d.longitude);
                      const isMatched = requests.some(r => r.matched_donor_id === d.user_id);
                      return (
                        <circle 
                          key={d.user_id}
                          cx={proj.x}
                          cy={proj.y}
                          r={isMatched ? "7" : "4.5"}
                          fill={isMatched ? "var(--color-success)" : "rgba(255,255,255,0.4)"}
                          stroke={isMatched ? "white" : "none"}
                          strokeWidth="1"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedDonor(d)}
                        >
                          <title>{`Donor ${d.user_id.substring(0,8)} - ${d.blood_group}`}</title>
                        </circle>
                      );
                    })}

                    {/* Plot Active Patients */}
                    {requests.map(req => {
                      if (req.status === 'COMPLETED') return null;
                      const proj = projectCoords(req.latitude, req.longitude);
                      return (
                        <g key={req.request_id}>
                          <circle cx={proj.x} cy={proj.y} r="14" fill="var(--color-primary-red)" opacity="0.25" className="pulse-glow" />
                          <circle cx={proj.x} cy={proj.y} r="6" fill="var(--color-primary-red)" />
                          <text x={proj.x + 12} y={proj.y + 4} fill="var(--color-accent-red)" fontSize="10" fontWeight="bold">
                            {`${req.blood_group} Patient (${req.priority})`}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  
                  {/* Legend Overlay */}
                  <div style={{ position: 'absolute', bottom: '15px', left: '15px', background: 'rgba(5, 5, 8, 0.85)', padding: '10px', border: '1px solid var(--border-glass)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div className="dot" style={{ background: 'var(--color-primary-red)', width: '10px', height: '10px' }}></div> Active Transfusion Request</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div className="dot" style={{ background: 'var(--color-success)', width: '10px', height: '10px' }}></div> Matched & Confirmed Donor</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div className="dot" style={{ background: 'rgba(255,255,255,0.4)', width: '10px', height: '10px' }}></div> Eligible Voluntary Donor</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div className="dot" style={{ background: 'var(--color-info)', width: '10px', height: '10px' }}></div> Partner Blood Bank/Hospital</div>
                  </div>
                </div>
              </div>

              {/* Active Care Bridges (Requests Queue) */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Active Care Waves & SLA Tracking</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-glass)', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        <th style={{ padding: '12px' }}>Request ID</th>
                        <th style={{ padding: '12px' }}>Blood Group</th>
                        <th style={{ padding: '12px' }}>Priority</th>
                        <th style={{ padding: '12px' }}>Status</th>
                        <th style={{ padding: '12px' }}>Active Wave</th>
                        <th style={{ padding: '12px' }}>Outreach Waves</th>
                        <th style={{ padding: '12px' }}>Wave Timeline (SLA)</th>
                        <th style={{ padding: '12px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map(req => {
                        const statusColors = {
                          "MATCHING": "badge-danger",
                          "CONFIRMED": "badge-warning",
                          "COMPLETED": "badge-success",
                          "ESCALATED": "badge-danger"
                        };
                        return (
                          <tr key={req.request_id} style={{ borderBottom: '1px solid var(--border-glass)', fontSize: '14px' }}>
                            <td style={{ padding: '12px', fontWeight: 'bold' }}>{req.request_id}</td>
                            <td style={{ padding: '12px' }}>{req.blood_group}</td>
                            <td style={{ padding: '12px' }}>
                              <span className={`badge-pill ${req.priority === 'Emergency' ? 'badge-danger' : 'badge-info'}`}>
                                {req.priority}
                              </span>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span className={`badge-pill ${statusColors[req.status] || ''}`}>
                                {req.status}
                              </span>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>{req.current_wave} / {req.total_waves}</td>
                            <td style={{ padding: '12px' }}>
                              <div style={{ display: 'flex', gap: '3px' }}>
                                {req.waves.map((w, idx) => (
                                  <div 
                                    key={idx} 
                                    style={{ 
                                      width: '12px', 
                                      height: '12px', 
                                      borderRadius: '50%', 
                                      background: req.current_wave > idx + 1 ? 'var(--color-primary-red)' : req.current_wave === idx + 1 ? 'var(--color-warning)' : 'rgba(255,255,255,0.1)'
                                    }}
                                    title={`Wave ${idx+1}: ${w.length} compatible donors`}
                                  />
                                ))}
                              </div>
                            </td>
                            <td style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
                              <Clock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                              {req.wave_started_at} (SLA: {req.sla_duration_hours}h)
                            </td>
                            <td style={{ padding: '12px' }}>
                              {req.status === 'MATCHING' && (
                                <button 
                                  className="btn-primary" 
                                  onClick={() => handleForceEscalate(req.request_id)}
                                  style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px' }}
                                >
                                  Escalate Wave
                                </button>
                              )}
                              {req.status === 'CONFIRMED' && (
                                <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <UserCheck size={14} /> Donor Scheduled
                                </span>
                              )}
                              {req.status === 'COMPLETED' && (
                                <span style={{ color: 'var(--color-text-dark)' }}>Resolved</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {requests.length === 0 && (
                        <tr>
                          <td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            No active requests. Submit a request in the Patient Portal.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* B. Management Stats Panel */}
          {activeRole === 'management' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              {/* KPI metrics row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
                <div className="glass-card" style={{ padding: '15px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Total Registry Donors</span>
                  <h2 style={{ fontSize: '28px', color: 'white', marginTop: '5px' }}>{stats.kpis.total_donors}</h2>
                </div>
                <div className="glass-card" style={{ padding: '15px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Active & Eligible Donors</span>
                  <h2 style={{ fontSize: '28px', color: 'var(--color-success)', marginTop: '5px' }}>{stats.kpis.eligible_donors}</h2>
                </div>
                <div className="glass-card" style={{ padding: '15px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Active Blood Bridges</span>
                  <h2 style={{ fontSize: '28px', color: 'var(--color-accent-red)', marginTop: '5px' }}>{stats.kpis.active_bridges}</h2>
                </div>
                <div className="glass-card" style={{ padding: '15px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Avg matching Response</span>
                  <h2 style={{ fontSize: '28px', color: 'var(--color-info)', marginTop: '5px' }}>{stats.kpis.avg_response_minutes}m</h2>
                </div>
                <div className="glass-card" style={{ padding: '15px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Conversion Rate</span>
                  <h2 style={{ fontSize: '28px', color: 'var(--color-warning)', marginTop: '5px' }}>{stats.kpis.conversion_rate_percent}%</h2>
                </div>
              </div>

              {/* Demand forecast chart */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>30-Day Blood Transfusion Demand Forecast (Thalassemia Windows)</h3>
                <div style={{ width: '100%', height: '250px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.forecast}>
                      <defs>
                        <linearGradient id="colorO" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-primary-red)" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="var(--color-primary-red)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorA" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} />
                      <YAxis stroke="var(--color-text-muted)" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#0c0d14', border: '1px solid var(--border-glass)', borderRadius: '8px' }} />
                      <Area type="monotone" dataKey="O Positive" name="O+ Required" stroke="var(--color-primary-red)" fillOpacity={1} fill="url(#colorO)" />
                      <Area type="monotone" dataKey="A Positive" name="A+ Required" stroke="var(--color-info)" fillOpacity={1} fill="url(#colorA)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Learning ledger & Churn risks dual row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
                {/* AI Ledger */}
                <div className="glass-card" style={{ padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={18} color="var(--color-warning)" />
                    AI Autonomic Self-Learning Ledger (Matching Policy Updates)
                  </h3>
                  <div style={{ maxHeight: '250px', overflowY: 'auto', fontSize: '13px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-glass)', color: 'var(--color-text-muted)' }}>
                          <th style={{ padding: '8px' }}>Timestamp</th>
                          <th style={{ padding: '8px' }}>Donor ID</th>
                          <th style={{ padding: '8px' }}>Decline Reason</th>
                          <th style={{ padding: '8px' }}>Autonomic Learning Adjustment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.ai_ledger.map((entry, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-glass)' }}>
                            <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>{entry.timestamp.substring(5,16)}</td>
                            <td style={{ padding: '8px', fontWeight: 'bold' }}>{entry.donor_id.substring(0,8)}</td>
                            <td style={{ padding: '8px', color: 'var(--color-accent-red)' }}>{entry.reason}</td>
                            <td style={{ padding: '8px', color: 'var(--color-success)' }}>{entry.action}</td>
                          </tr>
                        ))}
                        {stats.ai_ledger.length === 0 && (
                          <tr>
                            <td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                              Ledger is empty. Decline simulation triggers autonomic adjustments.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Churn Risks */}
                <div className="glass-card" style={{ padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={18} color="var(--color-accent-red)" />
                    Donor Fatigue & Pre-Emptive Churn Alerts
                  </h3>
                  <div style={{ maxHeight: '250px', overflowY: 'auto', fontSize: '13px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-glass)', color: 'var(--color-text-muted)' }}>
                          <th style={{ padding: '8px' }}>Donor ID</th>
                          <th style={{ padding: '8px' }}>Group</th>
                          <th style={{ padding: '8px' }}>Total Calls</th>
                          <th style={{ padding: '8px' }}>Call/Donation Ratio</th>
                          <th style={{ padding: '8px' }}>Risk Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.churn_risks.map((d, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-glass)' }}>
                            <td style={{ padding: '8px', fontWeight: 'bold' }}>{d.donor_id.substring(0,8)}</td>
                            <td style={{ padding: '8px' }}>{d.blood_group}</td>
                            <td style={{ padding: '8px' }}>{d.calls}</td>
                            <td style={{ padding: '8px', color: d.ratio > 6 ? 'var(--color-accent-red)' : 'var(--color-warning)' }}>{d.ratio}</td>
                            <td style={{ padding: '8px' }}>
                              <span className={`badge-pill ${d.status === 'Inactive' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                                {d.status === 'Inactive' ? 'Inactive (Churned)' : 'Fatigue Alert'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {stats.churn_risks.length === 0 && (
                          <tr>
                            <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                              No active fatigue or churn flags detected.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* C. Donor Portal */}
          {activeRole === 'donor' && currentDonor && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
              {/* Profile & preferences */}
              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ color: 'white', borderBottom: '1px solid var(--border-glass)', paddingBottom: '10px' }}>
                  Donor Eligibility & Settings
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Donor ID (Hash)</label>
                    <span style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{currentDonor.user_id}</span>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Blood Group</label>
                    <span style={{ color: 'var(--color-accent-red)', fontWeight: 'bold', fontSize: '16px' }}>{currentDonor.blood_group}</span>
                  </div>
                </div>

                {/* Eligibility Slider */}
                <div style={{ margin: '15px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '13px' }}>
                    <span>Eligibility Status</span>
                    <span style={{ color: currentDonor.eligibility_status === 'eligible' ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 'bold' }}>
                      {currentDonor.eligibility_status === 'eligible' ? "ELIGIBLE FOR DONATION" : "COOLDOWN INTERVAL ACTIVE"}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: currentDonor.eligibility_status === 'eligible' ? '100%' : '30%', height: '100%', background: currentDonor.eligibility_status === 'eligible' ? 'var(--color-success)' : 'var(--color-warning)' }} />
                  </div>
                  {currentDonor.next_eligible_date && (
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>
                      Eligible from: {currentDonor.next_eligible_date} (Last Donation: {currentDonor.last_donation_date || 'N/A'})
                    </span>
                  )}
                </div>

                {/* Configuration controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-glass)', paddingTop: '15px' }}>
                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Preferred Language for Alerts</label>
                    <select 
                      id="select-language"
                      className="glass-input" 
                      value={currentDonor.language} 
                      onChange={(e) => handleUpdatePreferences(currentDonor.user_id, e.target.value, currentDonor.consent, currentDonor.user_donation_active_status)}
                    >
                      <option value="English">English</option>
                      <option value="Hindi">Hindi (हिन्दी)</option>
                      <option value="Telugu">Telugu (తెలుగు)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Outreach Status</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        id="btn-status-active"
                        className={`btn-secondary ${currentDonor.user_donation_active_status === 'Active' ? 'active-btn' : ''}`}
                        onClick={() => handleUpdatePreferences(currentDonor.user_id, currentDonor.language, currentDonor.consent, 'Active')}
                        style={{ flex: 1, borderColor: currentDonor.user_donation_active_status === 'Active' ? 'var(--color-success)' : 'var(--border-glass)' }}
                      >
                        Active Availability
                      </button>
                      <button 
                        id="btn-status-inactive"
                        className={`btn-secondary ${currentDonor.user_donation_active_status === 'Inactive' ? 'active-btn' : ''}`}
                        onClick={() => handleUpdatePreferences(currentDonor.user_id, currentDonor.language, currentDonor.consent, 'Inactive')}
                        style={{ flex: 1, borderColor: currentDonor.user_donation_active_status === 'Inactive' ? 'var(--color-primary-red)' : 'var(--border-glass)' }}
                      >
                        Pause Alerts (Mute)
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                    <input 
                      id="checkbox-consent"
                      type="checkbox" 
                      checked={currentDonor.consent} 
                      onChange={(e) => handleUpdatePreferences(currentDonor.user_id, currentDonor.language, e.target.checked, currentDonor.user_donation_active_status)} 
                    />
                    <label htmlFor="checkbox-consent" style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      Explicit Consent: Allow Blood Warriors to contact me for transfusion requests under DPDPA framework.
                    </label>
                  </div>
                </div>
              </div>

              {/* Impact Wall and Badges */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Badges */}
                <div className="glass-card" style={{ padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Award size={18} color="var(--color-warning)" />
                    Lifesaver Badges & Milestone Levels
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    <div style={{ textAlign: 'center', padding: '10px', background: currentDonor.donations_till_date >= 1 ? 'rgba(214, 28, 46, 0.1)' : 'rgba(255,255,255,0.02)', border: '1px solid', borderColor: currentDonor.donations_till_date >= 1 ? 'var(--color-primary-red)' : 'var(--border-glass)', borderRadius: '8px' }}>
                      <Award size={28} color={currentDonor.donations_till_date >= 1 ? 'gold' : '#444'} style={{ margin: '0 auto 5px' }} />
                      <div style={{ fontSize: '11px', fontWeight: 'bold' }}>Bronze Star</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>1+ Donation</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', background: currentDonor.donations_till_date >= 3 ? 'rgba(214, 28, 46, 0.1)' : 'rgba(255,255,255,0.02)', border: '1px solid', borderColor: currentDonor.donations_till_date >= 3 ? 'var(--color-primary-red)' : 'var(--border-glass)', borderRadius: '8px' }}>
                      <Award size={28} color={currentDonor.donations_till_date >= 3 ? 'cyan' : '#444'} style={{ margin: '0 auto 5px' }} />
                      <div style={{ fontSize: '11px', fontWeight: 'bold' }}>Silver Bridge</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>3+ Donations</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', background: currentDonor.donations_till_date >= 5 ? 'rgba(214, 28, 46, 0.1)' : 'rgba(255,255,255,0.02)', border: '1px solid', borderColor: currentDonor.donations_till_date >= 5 ? 'var(--color-primary-red)' : 'var(--border-glass)', borderRadius: '8px' }}>
                      <Award size={28} color={currentDonor.donations_till_date >= 5 ? 'var(--color-accent-red)' : '#444'} style={{ margin: '0 auto 5px' }} />
                      <div style={{ fontSize: '11px', fontWeight: 'bold' }}>Gold Legend</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>5+ Donations</div>
                    </div>
                  </div>
                </div>

                {/* Patient stories wall */}
                <div className="glass-card" style={{ padding: '20px', flex: 1 }}>
                  <h3 style={{ marginBottom: '12px', color: 'white' }}>Donor Impact Wall</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', borderLeft: '3px solid var(--color-primary-red)', fontSize: '12px' }}>
                      <p style={{ fontStyle: 'italic' }}>"Your donation last month arrived just in time for my daughter's monthly transfusion. She went back to school yesterday smiling. Thank you!"</p>
                      <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', display: 'block', marginTop: '4px' }}>— Guardian of Patient A.</span>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', borderLeft: '3px solid var(--color-info)', fontSize: '12px' }}>
                      <p style={{ fontStyle: 'italic' }}>"You are our Blood Bridge. Knowing there is someone matched to my son who accepts the request so quickly gives our family peace of mind."</p>
                      <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', display: 'block', marginTop: '4px' }}>— Mother of Patient K.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* D. Patient Portal */}
          {activeRole === 'patient' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '20px' }}>
              {/* Submission form */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Submit Blood Transfusion Request</h3>
                <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Patient Reference ID</label>
                    <input 
                      id="input-patient-id"
                      type="text" 
                      className="glass-input" 
                      value={patientId} 
                      onChange={(e) => setPatientId(e.target.value)} 
                      required 
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Required Blood Group</label>
                    <select 
                      id="select-blood-group"
                      className="glass-input" 
                      value={bloodGroup} 
                      onChange={(e) => setBloodGroup(e.target.value)}
                    >
                      <option value="O Positive">O Positive</option>
                      <option value="A Positive">A Positive</option>
                      <option value="B Positive">B Positive</option>
                      <option value="AB Positive">AB Positive</option>
                      <option value="O Negative">O Negative</option>
                      <option value="A Negative">A Negative</option>
                      <option value="B Negative">B Negative</option>
                      <option value="AB Negative">AB Negative</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Quantity Needed (Units)</label>
                    <input 
                      id="input-quantity"
                      type="number" 
                      className="glass-input" 
                      value={quantity} 
                      min="1" 
                      max="4" 
                      onChange={(e) => setQuantity(e.target.value)} 
                      required 
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '5px' }}>Priority Level</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        id="btn-priority-emergency"
                        type="button" 
                        className={`btn-secondary ${priority === 'Emergency' ? 'active-btn' : ''}`}
                        onClick={() => setPriority('Emergency')}
                        style={{ flex: 1, borderColor: priority === 'Emergency' ? 'var(--color-primary-red)' : 'var(--border-glass)' }}
                      >
                        Emergency (SLA 1 hr)
                      </button>
                      <button 
                        id="btn-priority-routine"
                        type="button" 
                        className={`btn-secondary ${priority === 'Routine' ? 'active-btn' : ''}`}
                        onClick={() => setPriority('Routine')}
                        style={{ flex: 1, borderColor: priority === 'Routine' ? 'var(--color-info)' : 'var(--border-glass)' }}
                      >
                        Routine (SLA 4 hrs)
                      </button>
                    </div>
                  </div>

                  <button 
                    id="btn-submit-request"
                    type="submit" 
                    className="btn-primary" 
                    style={{ marginTop: '10px' }}
                  >
                    Initiate Smart Matching Waves
                  </button>
                </form>
              </div>

              {/* Transfusion status tracking */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Match Progress & Transfusion Tracker</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {requests.map(req => (
                    <div key={req.request_id} style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '15px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontWeight: 'bold' }}>Request {req.request_id} ({req.blood_group})</span>
                        <span className={`badge-pill ${req.status === 'COMPLETED' ? 'badge-success' : req.status === 'CONFIRMED' ? 'badge-warning' : 'badge-danger'}`}>
                          {req.status}
                        </span>
                      </div>
                      
                      {/* Timeline bar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-muted)', position: 'relative', padding: '10px 0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--color-primary-red)', marginBottom: '4px' }} />
                          <span>Submitted</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: req.status !== 'MATCHING' || req.current_wave > 1 ? 'var(--color-primary-red)' : 'rgba(255,255,255,0.1)', marginBottom: '4px' }} />
                          <span>Matching</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: req.status === 'CONFIRMED' || req.status === 'COMPLETED' ? 'var(--color-success)' : 'rgba(255,255,255,0.1)', marginBottom: '4px' }} />
                          <span>Matched</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: req.status === 'COMPLETED' ? 'var(--color-success)' : 'rgba(255,255,255,0.1)', marginBottom: '4px' }} />
                          <span>Transfused</span>
                        </div>
                        <div style={{ position: 'absolute', top: '17px', left: '20px', right: '20px', height: '2px', background: 'rgba(255,255,255,0.1)', zIndex: 0 }} />
                      </div>

                      {/* Outreach logs */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', fontSize: '12px', marginTop: '10px', maxHeight: '100px', overflowY: 'auto' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-bright)' }}>AI Match Engine Activity Logs:</div>
                        {req.outreach_logs.map((log, lidx) => (
                          <div key={lidx} style={{ marginBottom: '3px', color: 'var(--color-text-muted)' }}>
                            [{log.timestamp.substring(11,19)}] <strong>{log.event}</strong>: {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {requests.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '25px', color: 'var(--color-text-muted)' }}>
                      No current match operations in progress.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* E. Hospital Partner operations */}
          {activeRole === 'hospital' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
              {/* Scheduled appointments confirmations */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Scheduled Donor Appointments</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {requests.filter(r => r.status === 'CONFIRMED').map(req => (
                    <div key={req.request_id} style={{ border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '15px', background: 'rgba(255,255,255,0.01)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 'bold' }}>Donor Matched for Req {req.request_id}</span>
                        <span className="badge-pill badge-warning">Awaiting Donor</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
                        Donor ID: {req.matched_donor_id.substring(0, 8)} | Blood Group: {req.blood_group} | Volume: {req.quantity_required} Unit
                      </div>
                      <button 
                        id={`btn-complete-${req.request_id}`}
                        className="btn-primary" 
                        onClick={() => handleCompleteDonation(req.request_id)}
                        style={{ width: '100%', fontSize: '13px', gap: '4px' }}
                      >
                        <CheckCircle size={16} />
                        Confirm successful donation & trigger impact alert
                      </button>
                    </div>
                  ))}
                  {requests.filter(r => r.status === 'CONFIRMED').length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--color-text-muted)' }}>
                      No scheduled donor appointments. Matches will show up here when accepted.
                    </div>
                  )}
                </div>
              </div>

              {/* Hospital inventory */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Blood Bank Inventory Manager</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {inventory.map(item => (
                    <div key={item.blood_group} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{item.blood_group}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: item.units <= 2 ? 'var(--color-accent-red)' : 'white' }}>
                          {item.units} Unit{item.units !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button 
                          className="btn-secondary" 
                          onClick={() => handleUpdateInventory(item.blood_group, -1)}
                          style={{ padding: '4px 8px', borderRadius: '4px' }}
                        >
                          <Minus size={12} />
                        </button>
                        <button 
                          className="btn-secondary" 
                          onClick={() => handleUpdateInventory(item.blood_group, 1)}
                          style={{ padding: '4px 8px', borderRadius: '4px' }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* F. Community Page */}
          {activeRole === 'community' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Awareness resource */}
              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ color: 'white', borderBottom: '1px solid var(--border-glass)', paddingBottom: '8px' }}>
                  Thalassemia & Blood Donation awareness
                </h3>
                <div style={{ fontSize: '14px', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p>
                    <strong>What is Thalassemia?</strong><br />
                    Thalassemia is an inherited blood disorder characterized by less oxygen-carrying protein (hemoglobin) and fewer red blood cells than normal. Patients suffer from severe anemia and require regular, lifelong blood transfusions (every 2-4 weeks) to survive.
                  </p>
                  <p>
                    <strong>The Role of Blood Warriors</strong><br />
                    A Thalassemia patient may require between 500 to 700 transfusions in their lifetime. Blood Warriors' **Blood Bridge** program connects voluntary donors directly to patients, assuring them of a regular, reliable source of compatible blood.
                  </p>
                  <div style={{ background: 'rgba(214, 28, 46, 0.05)', border: '1px solid rgba(214, 28, 46, 0.2)', padding: '12px', borderRadius: '8px', color: 'white' }}>
                    <strong>Did you know?</strong><br />
                    One blood donation can save up to three lives. For Thalassemia children, regular donation is the difference between going to school or remaining bedridden.
                  </div>
                </div>
              </div>

              {/* Eligibility calculator */}
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ marginBottom: '15px', color: 'white' }}>Am I Eligible to Donate? (Quick Checker)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Are you aged 18 to 65?</span>
                    <input 
                      id="check-age"
                      type="checkbox" 
                      checked={questionnaire.age} 
                      onChange={(e) => setQuestionnaire({ ...questionnaire, age: e.target.checked })} 
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Is your weight over 45 kg?</span>
                    <input 
                      id="check-weight"
                      type="checkbox" 
                      checked={questionnaire.weight} 
                      onChange={(e) => setQuestionnaire({ ...questionnaire, weight: e.target.checked })} 
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Did you get a tattoo / body piercing in the last 6 months?</span>
                    <input 
                      id="check-tattoo"
                      type="checkbox" 
                      checked={questionnaire.tattoo} 
                      onChange={(e) => setQuestionnaire({ ...questionnaire, tattoo: e.target.checked })} 
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Have you had any viral fever or acute infection in the last 2 weeks?</span>
                    <input 
                      id="check-illness"
                      type="checkbox" 
                      checked={questionnaire.illness} 
                      onChange={(e) => setQuestionnaire({ ...questionnaire, illness: e.target.checked })} 
                    />
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '15px', marginTop: '10px', textAlign: 'center' }}>
                    {questionnaire.age && questionnaire.weight && !questionnaire.tattoo && !questionnaire.illness ? (
                      <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', fontWeight: 'bold' }}>
                        ✓ You look eligible to donate! Click on Donor Portal to register.
                      </div>
                    ) : (
                      <div style={{ padding: '12px', background: 'rgba(214, 28, 46, 0.1)', color: 'var(--color-accent-red)', border: '1px solid rgba(214, 28, 46, 0.3)', borderRadius: '8px', fontWeight: 'bold' }}>
                        ✗ You are not eligible to donate at this time. Please check general blood rules or try again later.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. Live Email Outreach Simulator drawer */}
        <aside style={{ width: '340px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-card" style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '10px', marginBottom: '15px' }}>
              <Mail size={18} color="var(--color-primary-red)" />
              Email Alert Simulator
            </h3>
            
            {/* Outbound Email List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outbound Emails Sent</span>
              {emails.map((mail) => (
                <div 
                  key={mail.id} 
                  onClick={() => {
                    setActiveEmail(mail);
                    setAiAnalysis(null);
                  }}
                  style={{ 
                    padding: '10px', 
                    background: activeEmail?.id === mail.id ? 'rgba(214,28,46,0.1)' : 'rgba(255,255,255,0.02)', 
                    border: '1px solid',
                    borderColor: activeEmail?.id === mail.id ? 'var(--color-primary-red)' : 'var(--border-glass)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: 'white' }}>
                    <span>To: {mail.to}</span>
                    <span style={{ fontSize: '9px', color: 'var(--color-success)' }}>{mail.status}</span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)', margin: '3px 0 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mail.subject}
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-dark)' }}>{mail.timestamp}</span>
                </div>
              ))}
              {emails.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-dark)', fontSize: '12px' }}>
                  No emails sent yet. Submit a request to trigger outreach logs.
                </div>
              )}
            </div>

            {/* Active Email Preview & Simulation replying */}
            {activeEmail && (
              <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Email Body Preview:</span>
                <div 
                  style={{ background: '#ffffff', color: '#333333', padding: '12px', borderRadius: '6px', fontSize: '11px', maxHeight: '180px', overflowY: 'auto' }}
                  dangerouslySetInnerHTML={{ __html: activeEmail.body_html }}
                />
                
                {/* One click link simulator in email body */}
                {activeEmail.body_html.includes("respond?request_id=") && (
                  <div style={{ display: 'flex', gap: '10px', fontSize: '11px' }}>
                    <button 
                      id="btn-simulate-email-accept"
                      className="btn-primary" 
                      onClick={() => {
                        // Extract request_id and donor_id from html content or logs
                        const reqId = activeEmail.body_html.split("request_id=")[1].split("&")[0];
                        const donorId = activeEmail.body_html.split("donor_id=")[1].split("&")[0];
                        handleEmailActionClick(reqId, donorId, 'accept');
                      }}
                      style={{ padding: '6px', flex: 1, background: 'var(--color-success)' }}
                    >
                      Click Accept Link
                    </button>
                    <button 
                      id="btn-simulate-email-decline"
                      className="btn-secondary" 
                      onClick={() => {
                        const reqId = activeEmail.body_html.split("request_id=")[1].split("&")[0];
                        const donorId = activeEmail.body_html.split("donor_id=")[1].split("&")[0];
                        handleEmailActionClick(reqId, donorId, 'decline');
                      }}
                      style={{ padding: '6px', flex: 1 }}
                    >
                      Click Decline Link
                    </button>
                  </div>
                )}

                {/* Simulated reply form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px dashed var(--border-glass)', paddingTop: '10px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Simulate Donor Email Reply:</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <textarea 
                      id="textarea-email-reply"
                      className="glass-input" 
                      value={replyText} 
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type email reply (e.g. 'I will come tomorrow' or in Hindi/Telugu)..."
                      style={{ height: '55px', fontSize: '12px', resize: 'none' }}
                    />
                    <button 
                      id="btn-send-email-reply"
                      className="btn-primary" 
                      onClick={handleSendEmailReply}
                      style={{ padding: '10px' }}
                      title="Send simulated email response"
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>

                {/* AI Analysis parsed result */}
                {aiAnalysis && (
                  <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', fontSize: '11px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--color-info)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Activity size={12} /> AWS Bedrock NLP Analysis
                    </div>
                    <div>Detected Language: <strong>{aiAnalysis.detected_language}</strong></div>
                    <div>Extracted Intent: <strong>{aiAnalysis.status?.toUpperCase()}</strong></div>
                    <div>Reason: <span style={{ color: 'var(--color-text-muted)' }}>{aiAnalysis.reason}</span></div>
                    <div style={{ fontSize: '9px', color: 'var(--color-text-dark)', marginTop: '4px' }}>Confidence Score: {aiAnalysis.confidence}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
