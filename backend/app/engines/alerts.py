"""Early-warning rules (configurable) and multilingual action templates."""
from __future__ import annotations

import copy

LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"]

DEFAULT_THRESHOLDS = {
    "rainfall_mm_hr": {"YELLOW": 30, "ORANGE": 60, "RED": 100, "higher_is_worse": True},
    "flood_probability": {"YELLOW": 0.30, "ORANGE": 0.60, "RED": 0.85, "higher_is_worse": True},
    "depth_m": {"YELLOW": 0.10, "ORANGE": 0.30, "RED": 0.50, "higher_is_worse": True},
    "time_to_flood_min": {"YELLOW": 180, "ORANGE": 60, "RED": 30, "higher_is_worse": False},
    "drainage_utilization": {"YELLOW": 0.90, "ORANGE": 1.20, "RED": 1.60, "higher_is_worse": True},
}
_thresholds = copy.deepcopy(DEFAULT_THRESHOLDS)


def get_thresholds() -> dict:
    return copy.deepcopy(_thresholds)


def set_thresholds(new: dict) -> dict:
    for k, v in new.items():
        if k in _thresholds:
            for lvl in ("YELLOW", "ORANGE", "RED"):
                if lvl in v:
                    _thresholds[k][lvl] = float(v[lvl])
    return get_thresholds()


def reset_thresholds() -> dict:
    global _thresholds
    _thresholds = copy.deepcopy(DEFAULT_THRESHOLDS)
    return get_thresholds()


def evaluate(metrics: dict) -> tuple[str, list[dict]]:
    """metrics: rainfall_mm_hr, flood_probability, depth_m, time_to_flood_min (None=no flood), drainage_utilization."""
    level = 0
    triggers = []
    for key, th in _thresholds.items():
        v = metrics.get(key)
        if v is None:
            continue
        if key == "time_to_flood_min" and metrics.get("flood_probability", 0) < 0.5:
            continue
        for i, lvl in reversed(list(enumerate(LEVELS))):
            if i == 0:
                break
            hit = v >= th[lvl] if th["higher_is_worse"] else v <= th[lvl]
            if hit:
                if i > level:
                    level = i
                triggers.append({"metric": key, "value": v, "threshold": th[lvl], "level": lvl})
                break
    return LEVELS[level], triggers


ACTIONS = {
    "GREEN": {
        "authority": ["Continue routine monitoring of nowcast and drainage dashboard."],
        "citizen": ["No action needed. Stay informed via official channels."],
    },
    "YELLOW": {
        "authority": ["Alert ward engineers; pre-position suction pumps at low-lying junctions.",
                      "Clear inlets / grates on listed roads; verify drain blockage hotspots."],
        "citizen": ["Avoid low-lying roads and underpasses if rain intensifies.", "Keep phones charged; follow official updates."],
    },
    "ORANGE": {
        "authority": ["Deploy dewatering pumps and traffic police to affected junctions.",
                      "Divert traffic from listed roads; brief hospitals on access routes.",
                      "Put disaster response teams and shelters on standby."],
        "citizen": ["Avoid travel through the listed roads.", "Move vehicles and valuables to higher ground.",
                    "Do not walk or drive through flowing water."],
    },
    "RED": {
        "authority": ["Close listed roads and underpasses immediately; activate emergency routing.",
                      "Dispatch rescue teams (fire/NDRF/SDRF as applicable); open relief shelters.",
                      "Isolate power to flooded substations/feeders if water exceeds safe level.",
                      "Issue public warning via SMS/web in local languages."],
        "citizen": ["Stay indoors or move to the nearest shelter on high ground.", "Call 112 in an emergency.",
                    "Do not enter flood water — depth may exceed 0.5 m and currents can be strong.",
                    "Switch off electricity if water enters your home."],
    },
}

# Multilingual citizen headline templates (en, hi, te, ta, mr)
HEADLINES = {
    "en": {"GREEN": "No flood threat expected", "YELLOW": "Flood watch: waterlogging possible",
           "ORANGE": "Flood warning: roads likely to flood", "RED": "SEVERE flood alert: act now"},
    "hi": {"GREEN": "बाढ़ का कोई खतरा अपेक्षित नहीं", "YELLOW": "बाढ़ निगरानी: जलभराव संभव",
           "ORANGE": "बाढ़ चेतावनी: सड़कों पर पानी भरने की संभावना", "RED": "गंभीर बाढ़ अलर्ट: तुरंत कार्रवाई करें"},
    "te": {"GREEN": "వరద ముప్పు లేదు", "YELLOW": "వరద పర్యవేక్షణ: నీరు నిలిచే అవకాశం",
           "ORANGE": "వరద హెచ్చరిక: రహదారులు మునిగే అవకాశం", "RED": "తీవ్ర వరద హెచ్చరిక: వెంటనే చర్య తీసుకోండి"},
    "ta": {"GREEN": "வெள்ள அபாயம் இல்லை", "YELLOW": "வெள்ள கண்காணிப்பு: நீர் தேக்கம் சாத்தியம்",
           "ORANGE": "வெள்ள எச்சரிக்கை: சாலைகளில் வெள்ளம் வாய்ப்பு", "RED": "கடுமையான வெள்ள எச்சரிக்கை: உடனே செயல்படுங்கள்"},
    "mr": {"GREEN": "पुराचा धोका अपेक्षित नाही", "YELLOW": "पूर निरीक्षण: पाणी साचण्याची शक्यता",
           "ORANGE": "पूर इशारा: रस्ते पाण्याखाली जाण्याची शक्यता", "RED": "गंभीर पूर इशारा: त्वरित कृती करा"},
}
CITIZEN_ACTIONS_I18N = {
    "hi": {"YELLOW": "निचले रास्तों और अंडरपास से बचें।", "ORANGE": "सूचीबद्ध सड़कों से यात्रा न करें। वाहन ऊंचे स्थान पर रखें।",
           "RED": "घर के अंदर रहें या नजदीकी आश्रय में जाएं। आपात स्थिति में 112 पर कॉल करें।", "GREEN": "कोई कार्रवाई आवश्यक नहीं।"},
    "te": {"YELLOW": "లోతట్టు రహదారులు, అండర్‌పాస్‌లను నివారించండి.", "ORANGE": "జాబితాలోని రహదారుల్లో ప్రయాణించవద్దు. వాహనాలను ఎత్తైన ప్రదేశానికి తరలించండి.",
           "RED": "ఇంట్లోనే ఉండండి లేదా సమీప ఆశ్రయానికి వెళ్లండి. అత్యవసరంలో 112కు కాల్ చేయండి.", "GREEN": "ఎలాంటి చర్య అవసరం లేదు."},
    "ta": {"YELLOW": "தாழ்வான சாலைகள் மற்றும் சுரங்கப்பாதைகளைத் தவிர்க்கவும்.", "ORANGE": "பட்டியலிடப்பட்ட சாலைகளில் பயணிக்க வேண்டாம். வாகனங்களை உயரமான இடத்திற்கு நகர்த்துங்கள்.",
           "RED": "வீட்டிற்குள் இருங்கள் அல்லது அருகிலுள்ள தங்குமிடத்திற்குச் செல்லுங்கள். அவசரத்தில் 112 அழைக்கவும்.", "GREEN": "நடவடிக்கை தேவையில்லை."},
    "mr": {"YELLOW": "सखल रस्ते व भुयारी मार्ग टाळा.", "ORANGE": "यादीतील रस्त्यांवरून प्रवास करू नका. वाहने उंच ठिकाणी हलवा.",
           "RED": "घरातच रहा किंवा जवळच्या निवाऱ्यात जा. आपत्कालीन परिस्थितीत 112 वर कॉल करा.", "GREEN": "कोणतीही कृती आवश्यक नाही."},
}


def citizen_message(level: str, lang: str, location: str) -> dict:
    lang = lang if lang in HEADLINES else "en"
    head = HEADLINES[lang][level]
    action = " ".join(ACTIONS[level]["citizen"]) if lang == "en" else CITIZEN_ACTIONS_I18N[lang][level]
    return {"language": lang, "headline": f"{head} — {location}", "action": action}
