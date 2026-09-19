/* UI translations for navigation, alerts and citizen functions (en, hi, te, ta, mr). */
export type Lang = "en" | "hi" | "te" | "ta" | "mr";
export const LANGS: { code: Lang; name: string }[] = [
  { code: "en", name: "English" }, { code: "hi", name: "हिन्दी" }, { code: "te", name: "తెలుగు" },
  { code: "ta", name: "தமிழ்" }, { code: "mr", name: "मराठी" },
];

type Dict = Record<string, string>;
const en: Dict = {
  dashboard: "Command Center", map: "Live Flood Map", rainfall: "Rainfall Nowcast", terrain: "Terrain & Runoff",
  drainage: "Drainage Network", prediction: "Flood Prediction", risk: "Risk Analysis", whatif: "What-If Simulator",
  routing: "Emergency Routing", infrastructure: "Infrastructure", cctv: "CCTV Analysis", reports_citizen: "Citizen Reports",
  historical: "Historical Analytics", maintenance: "Drain Maintenance", emergency: "Emergency & Helplines", copilot: "AI Copilot",
  incidents: "Incidents", reports: "Reports", settings: "Settings", profile: "Profile", logout: "Sign out",
  call112: "CALL 112", nearest_hospital: "FIND NEAREST HOSPITAL", safe_route: "VIEW SAFE ROUTE", report_flood: "REPORT FLOOD",
  view_contacts: "VIEW EMERGENCY CONTACTS", active_alerts: "Active alerts", no_alerts: "No active flood alerts",
  your_location: "Your location", submit: "Submit", depth_estimate: "Estimated water depth (cm)", road_condition: "Road condition",
  description: "Description", photo: "Photo (optional)", use_my_location: "Use my location", pick_on_map: "Tap the map to set location",
  report_sent: "Report submitted. Thank you — authorities will review it.", language: "Language", theme: "Theme",
  online: "ONLINE", degraded: "DEGRADED", offline: "OFFLINE", stay_safe: "Stay safe. In an emergency, call 112.",
  expected: "Expected", depth: "Depth", affected_roads: "Affected roads", recommended_action: "Recommended action",
  sign_in: "Sign in", register: "Create account", forgot: "Forgot password?", email: "Email", password: "Password",
  full_name: "Full name", city: "City", nearest_help: "Nearest help",
};
const hi: Dict = {
  dashboard: "कमांड सेंटर", map: "लाइव बाढ़ मानचित्र", rainfall: "वर्षा नाउकास्ट", terrain: "भू-भाग और अपवाह",
  drainage: "जल निकासी नेटवर्क", prediction: "बाढ़ पूर्वानुमान", risk: "जोखिम विश्लेषण", whatif: "क्या-अगर सिम्युलेटर",
  routing: "आपातकालीन मार्ग", infrastructure: "अवसंरचना", cctv: "सीसीटीवी विश्लेषण", reports_citizen: "नागरिक रिपोर्ट",
  historical: "ऐतिहासिक विश्लेषण", maintenance: "नाली रखरखाव", emergency: "आपातकाल और हेल्पलाइन", copilot: "एआई कोपायलट",
  incidents: "घटनाएँ", reports: "रिपोर्ट", settings: "सेटिंग्स", profile: "प्रोफ़ाइल", logout: "साइन आउट",
  call112: "112 पर कॉल करें", nearest_hospital: "निकटतम अस्पताल खोजें", safe_route: "सुरक्षित मार्ग देखें", report_flood: "बाढ़ की सूचना दें",
  view_contacts: "आपातकालीन संपर्क देखें", active_alerts: "सक्रिय अलर्ट", no_alerts: "कोई सक्रिय बाढ़ अलर्ट नहीं",
  your_location: "आपका स्थान", submit: "जमा करें", depth_estimate: "अनुमानित पानी की गहराई (सेमी)", road_condition: "सड़क की स्थिति",
  description: "विवरण", photo: "फोटो (वैकल्पिक)", use_my_location: "मेरा स्थान उपयोग करें", pick_on_map: "स्थान चुनने के लिए मानचित्र पर टैप करें",
  report_sent: "रिपोर्ट जमा हो गई। धन्यवाद — अधिकारी इसकी समीक्षा करेंगे।", language: "भाषा", theme: "थीम",
  online: "ऑनलाइन", degraded: "सीमित", offline: "ऑफ़लाइन", stay_safe: "सुरक्षित रहें। आपात स्थिति में 112 पर कॉल करें।",
  expected: "अपेक्षित", depth: "गहराई", affected_roads: "प्रभावित सड़कें", recommended_action: "अनुशंसित कार्रवाई",
  sign_in: "साइन इन", register: "खाता बनाएँ", forgot: "पासवर्ड भूल गए?", email: "ईमेल", password: "पासवर्ड",
  full_name: "पूरा नाम", city: "शहर", nearest_help: "निकटतम सहायता",
};
const te: Dict = {
  dashboard: "కమాండ్ సెంటర్", map: "ప్రత్యక్ష వరద పటం", rainfall: "వర్ష నౌకాస్ట్", terrain: "భూభాగం & ప్రవాహం",
  drainage: "డ్రైనేజీ నెట్‌వర్క్", prediction: "వరద అంచనా", risk: "ప్రమాద విశ్లేషణ", whatif: "వాట్-ఇఫ్ సిమ్యులేటర్",
  routing: "అత్యవసర మార్గం", infrastructure: "మౌలిక సదుపాయాలు", cctv: "సీసీటీవీ విశ్లేషణ", reports_citizen: "పౌర నివేదికలు",
  historical: "చారిత్రక విశ్లేషణ", maintenance: "డ్రైన్ నిర్వహణ", emergency: "అత్యవసర & హెల్ప్‌లైన్లు", copilot: "ఏఐ కోపైలట్",
  incidents: "సంఘటనలు", reports: "నివేదికలు", settings: "సెట్టింగ్‌లు", profile: "ప్రొఫైల్", logout: "సైన్ అవుట్",
  call112: "112కు కాల్ చేయండి", nearest_hospital: "సమీప ఆసుపత్రి", safe_route: "సురక్షిత మార్గం", report_flood: "వరద నివేదించండి",
  view_contacts: "అత్యవసర సంప్రదింపులు", active_alerts: "క్రియాశీల హెచ్చరికలు", no_alerts: "క్రియాశీల వరద హెచ్చరికలు లేవు",
  your_location: "మీ స్థానం", submit: "సమర్పించండి", depth_estimate: "అంచనా నీటి లోతు (సెం.మీ)", road_condition: "రహదారి పరిస్థితి",
  description: "వివరణ", photo: "ఫోటో (ఐచ్ఛికం)", use_my_location: "నా స్థానాన్ని ఉపయోగించండి", pick_on_map: "స్థానం కోసం పటంపై తాకండి",
  report_sent: "నివేదిక సమర్పించబడింది. ధన్యవాదాలు — అధికారులు సమీక్షిస్తారు.", language: "భాష", theme: "థీమ్",
  online: "ఆన్‌లైన్", degraded: "పరిమితం", offline: "ఆఫ్‌లైన్", stay_safe: "సురక్షితంగా ఉండండి. అత్యవసరంలో 112కు కాల్ చేయండి.",
  expected: "అంచనా", depth: "లోతు", affected_roads: "ప్రభావిత రహదారులు", recommended_action: "సిఫార్సు చేసిన చర్య",
  sign_in: "సైన్ ఇన్", register: "ఖాతా సృష్టించండి", forgot: "పాస్‌వర్డ్ మర్చిపోయారా?", email: "ఇమెయిల్", password: "పాస్‌వర్డ్",
  full_name: "పూర్తి పేరు", city: "నగరం", nearest_help: "సమీప సహాయం",
};
const ta: Dict = {
  dashboard: "கட்டளை மையம்", map: "நேரடி வெள்ள வரைபடம்", rainfall: "மழை நவ்காஸ்ட்", terrain: "நிலப்பரப்பு & ஓட்டம்",
  drainage: "வடிகால் வலையமைப்பு", prediction: "வெள்ள முன்னறிவிப்பு", risk: "அபாய பகுப்பாய்வு", whatif: "என்ன-என்றால் சிமுலேட்டர்",
  routing: "அவசர வழித்தடம்", infrastructure: "உள்கட்டமைப்பு", cctv: "சிசிடிவி பகுப்பாய்வு", reports_citizen: "குடிமக்கள் அறிக்கைகள்",
  historical: "வரலாற்று பகுப்பாய்வு", maintenance: "வடிகால் பராமரிப்பு", emergency: "அவசர & உதவி எண்கள்", copilot: "ஏஐ கோபைலட்",
  incidents: "சம்பவங்கள்", reports: "அறிக்கைகள்", settings: "அமைப்புகள்", profile: "சுயவிவரம்", logout: "வெளியேறு",
  call112: "112 அழைக்கவும்", nearest_hospital: "அருகிலுள்ள மருத்துவமனை", safe_route: "பாதுகாப்பான வழி", report_flood: "வெள்ளம் தெரிவிக்க",
  view_contacts: "அவசர தொடர்புகள்", active_alerts: "செயலில் உள்ள எச்சரிக்கைகள்", no_alerts: "செயலில் வெள்ள எச்சரிக்கை இல்லை",
  your_location: "உங்கள் இருப்பிடம்", submit: "சமர்ப்பிக்கவும்", depth_estimate: "மதிப்பிடப்பட்ட நீர் ஆழம் (செ.மீ)", road_condition: "சாலை நிலை",
  description: "விவரம்", photo: "புகைப்படம் (விருப்பம்)", use_my_location: "என் இருப்பிடத்தைப் பயன்படுத்து", pick_on_map: "இருப்பிடத்திற்கு வரைபடத்தைத் தட்டவும்",
  report_sent: "அறிக்கை சமர்ப்பிக்கப்பட்டது. நன்றி — அதிகாரிகள் பரிசீலிப்பார்கள்.", language: "மொழி", theme: "தீம்",
  online: "இணைப்பில்", degraded: "குறைந்த இணைப்பு", offline: "இணைப்பில்லை", stay_safe: "பாதுகாப்பாக இருங்கள். அவசரத்தில் 112 அழைக்கவும்.",
  expected: "எதிர்பார்ப்பு", depth: "ஆழம்", affected_roads: "பாதிக்கப்பட்ட சாலைகள்", recommended_action: "பரிந்துரைக்கப்பட்ட நடவடிக்கை",
  sign_in: "உள்நுழை", register: "கணக்கு உருவாக்கு", forgot: "கடவுச்சொல் மறந்துவிட்டதா?", email: "மின்னஞ்சல்", password: "கடவுச்சொல்",
  full_name: "முழு பெயர்", city: "நகரம்", nearest_help: "அருகிலுள்ள உதவி",
};
const mr: Dict = {
  dashboard: "कमांड सेंटर", map: "थेट पूर नकाशा", rainfall: "पाऊस नाउकास्ट", terrain: "भूभाग व अपवाह",
  drainage: "निचरा जाळे", prediction: "पूर अंदाज", risk: "धोका विश्लेषण", whatif: "काय-जर सिम्युलेटर",
  routing: "आपत्कालीन मार्ग", infrastructure: "पायाभूत सुविधा", cctv: "सीसीटीव्ही विश्लेषण", reports_citizen: "नागरिक अहवाल",
  historical: "ऐतिहासिक विश्लेषण", maintenance: "गटार देखभाल", emergency: "आपत्कालीन व हेल्पलाइन", copilot: "एआय कोपायलट",
  incidents: "घटना", reports: "अहवाल", settings: "सेटिंग्ज", profile: "प्रोफाइल", logout: "साइन आउट",
  call112: "112 वर कॉल करा", nearest_hospital: "जवळचे रुग्णालय शोधा", safe_route: "सुरक्षित मार्ग पहा", report_flood: "पुराची माहिती द्या",
  view_contacts: "आपत्कालीन संपर्क पहा", active_alerts: "सक्रिय इशारे", no_alerts: "कोणतेही सक्रिय पूर इशारे नाहीत",
  your_location: "तुमचे स्थान", submit: "सादर करा", depth_estimate: "अंदाजे पाण्याची खोली (सेमी)", road_condition: "रस्त्याची स्थिती",
  description: "वर्णन", photo: "फोटो (ऐच्छिक)", use_my_location: "माझे स्थान वापरा", pick_on_map: "स्थानासाठी नकाशावर टॅप करा",
  report_sent: "अहवाल सादर झाला. धन्यवाद — अधिकारी तपासतील.", language: "भाषा", theme: "थीम",
  online: "ऑनलाइन", degraded: "मर्यादित", offline: "ऑफलाइन", stay_safe: "सुरक्षित रहा. आपत्कालीन स्थितीत 112 वर कॉल करा.",
  expected: "अपेक्षित", depth: "खोली", affected_roads: "प्रभावित रस्ते", recommended_action: "शिफारस केलेली कृती",
  sign_in: "साइन इन", register: "खाते तयार करा", forgot: "पासवर्ड विसरलात?", email: "ईमेल", password: "पासवर्ड",
  full_name: "पूर्ण नाव", city: "शहर", nearest_help: "जवळची मदत",
};
export const DICTS: Record<Lang, Dict> = { en, hi, te, ta, mr };
export function translate(lang: Lang, key: string): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}
