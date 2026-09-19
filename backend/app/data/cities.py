"""Configurable city definitions.

Coordinates are real city centres; everything generated *from* them (DEM, roads, drains,
facility placements) is deterministic DEMO data unless a real dataset is loaded
(see docs/GIS.md for loading SRTM/Cartosat DEM GeoTIFFs and OSM road networks).
Local helpline numbers are intentionally NOT hard-coded as verified — they are marked
`verified=False` and must be confirmed by the deploying municipality.
"""

CITIES: dict[str, dict] = {
    "hyderabad": {
        "name": "Hyderabad", "state": "Telangana", "center": (17.4065, 78.4772), "span_deg": 0.075,
        "base_elev": 520.0, "relief": 38.0, "seed": 1701, "river": "Musi",
        "areas": ["Ameerpet", "Begumpet", "Khairatabad", "Lakdikapul", "Nampally", "Abids", "Koti",
                  "Himayatnagar", "Musheerabad", "Secunderabad", "Tolichowki", "Mehdipatnam",
                  "Masab Tank", "Punjagutta", "Somajiguda", "Chaderghat"],
        "streets": ["Raj Bhavan Rd", "Tank Bund Rd", "SP Rd", "Necklace Rd", "MG Rd", "Station Rd",
                    "Liberty Rd", "Basheerbagh Rd", "RTC X Rd", "Mehdipatnam Rd", "Masab Tank Rd",
                    "Somajiguda Rd", "Punjagutta Main Rd", "Koti Main Rd", "Chaderghat Rd", "Nampally Station Rd"],
        "monsoon_months": [6, 7, 8, 9, 10],
    },
    "mumbai": {
        "name": "Mumbai", "state": "Maharashtra", "center": (19.0330, 72.8570), "span_deg": 0.07,
        "base_elev": 4.0, "relief": 22.0, "seed": 2605, "river": "Mithi",
        "areas": ["Dadar", "Sion", "Kurla", "Bandra", "Mahim", "Matunga", "Wadala", "Dharavi",
                  "Parel", "Worli", "Chembur", "Ghatkopar", "Santacruz", "Andheri", "Kalina", "BKC"],
        "streets": ["LBS Marg", "SV Rd", "Western Express Hwy", "Eastern Express Hwy", "Tulsi Pipe Rd",
                    "Senapati Bapat Marg", "Dr Ambedkar Rd", "Sion Trombay Rd", "Mahim Causeway",
                    "Kurla Andheri Rd", "Linking Rd", "Hill Rd", "BKC Rd", "Dharavi Main Rd", "Parel Rd", "Worli Sea Face"],
        "monsoon_months": [6, 7, 8, 9],
    },
    "delhi": {
        "name": "Delhi", "state": "Delhi (NCT)", "center": (28.6280, 77.2210), "span_deg": 0.075,
        "base_elev": 214.0, "relief": 18.0, "seed": 1103, "river": "Yamuna",
        "areas": ["Connaught Place", "Minto Road", "ITO", "Pragati Maidan", "Karol Bagh", "Paharganj",
                  "Daryaganj", "Rajghat", "Mandi House", "Bhairon Marg", "Kashmere Gate", "Jhandewalan",
                  "Patel Nagar", "Rajendra Place", "Chandni Chowk", "Civil Lines"],
        "streets": ["Minto Rd", "Ring Rd", "Mathura Rd", "Bahadur Shah Zafar Marg", "Janpath", "Barakhamba Rd",
                    "Pusa Rd", "DB Gupta Rd", "Rani Jhansi Rd", "Vikas Marg", "Outer Ring Rd", "Netaji Subhash Marg",
                    "Tilak Marg", "Copernicus Marg", "Sikandra Rd", "Bhairon Marg"],
        "monsoon_months": [7, 8, 9],
    },
    "chennai": {
        "name": "Chennai", "state": "Tamil Nadu", "center": (13.0500, 80.2450), "span_deg": 0.075,
        "base_elev": 6.0, "relief": 14.0, "seed": 3112, "river": "Adyar",
        "areas": ["T Nagar", "Velachery", "Saidapet", "Guindy", "Mylapore", "Egmore", "Nungambakkam",
                  "Kodambakkam", "Ashok Nagar", "KK Nagar", "Adyar", "Teynampet", "Royapettah",
                  "Vadapalani", "Anna Nagar", "Triplicane"],
        "streets": ["Anna Salai", "GST Rd", "Poonamallee High Rd", "Arcot Rd", "Usman Rd", "Kamarajar Salai",
                    "Sardar Patel Rd", "Velachery Main Rd", "LB Rd", "TTK Rd", "Nungambakkam High Rd",
                    "100 Feet Rd", "Inner Ring Rd", "Mount Rd", "Kodambakkam High Rd", "Greams Rd"],
        "monsoon_months": [10, 11, 12],
    },
    "bengaluru": {
        "name": "Bengaluru", "state": "Karnataka", "center": (12.9600, 77.6100), "span_deg": 0.075,
        "base_elev": 900.0, "relief": 45.0, "seed": 5609, "river": "Vrishabhavathi",
        "areas": ["Koramangala", "Silk Board", "HSR Layout", "Ejipura", "Indiranagar", "Domlur",
                  "Shivajinagar", "Majestic", "Jayanagar", "BTM Layout", "Bellandur", "Madiwala",
                  "Richmond Town", "Ulsoor", "Wilson Garden", "Shantinagar"],
        "streets": ["Hosur Rd", "Outer Ring Rd", "Old Airport Rd", "Sarjapur Rd", "100 Feet Rd",
                    "Intermediate Ring Rd", "MG Rd", "Residency Rd", "Richmond Rd", "Lalbagh Rd",
                    "Bannerghatta Rd", "Hosur Main Rd", "Inner Ring Rd", "Double Rd", "KH Rd", "Cubbon Rd"],
        "monsoon_months": [6, 7, 8, 9, 10],
    },
    "visakhapatnam": {
        "name": "Visakhapatnam", "state": "Andhra Pradesh", "center": (17.7200, 83.3000), "span_deg": 0.07,
        "base_elev": 12.0, "relief": 60.0, "seed": 4721, "river": "Meghadri Gedda",
        "areas": ["Dwaraka Nagar", "Siripuram", "Maddilapalem", "Seethammadhara", "Akkayyapalem",
                  "Gajuwaka", "MVP Colony", "Jagadamba", "Allipuram", "Railway New Colony",
                  "Asilmetta", "Daba Gardens", "Kancharapalem", "Beach Road", "Waltair", "Pedawaltair"],
        "streets": ["Beach Rd", "NH16", "Dwaraka Nagar Main Rd", "Waltair Main Rd", "Asilmetta Rd",
                    "Akkayyapalem Rd", "Jail Rd", "VIP Rd", "Daba Gardens Rd", "Kancharapalem Rd",
                    "Station Rd", "Siripuram Rd", "MVP Double Rd", "Maddilapalem Rd", "Seethammadhara Rd", "Old Town Rd"],
        "monsoon_months": [7, 8, 9, 10, 11],
    },
}

INFRA_KINDS = {
    "hospital": {"count": 6, "label": "Hospital"},
    "police": {"count": 5, "label": "Police Station"},
    "fire_station": {"count": 4, "label": "Fire Station"},
    "school": {"count": 6, "label": "School"},
    "railway_station": {"count": 3, "label": "Railway/Metro Station"},
    "bus_terminal": {"count": 2, "label": "Bus Terminal"},
    "shelter": {"count": 4, "label": "Relief Shelter"},
    "substation": {"count": 4, "label": "Power Substation"},
    "government": {"count": 3, "label": "Government Office"},
}


def get_city(key: str) -> dict:
    k = (key or "").lower()
    if k not in CITIES:
        raise KeyError(f"Unknown city '{key}'. Available: {', '.join(CITIES)}")
    return CITIES[k]
