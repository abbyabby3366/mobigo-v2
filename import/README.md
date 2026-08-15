# Template Export & Import Package

This directory contains the export package and automated synchronization script for the **Phone Rental Service Template** (23 fields, 26 pages PDF contract).

---

## 📁 Files in This Directory

| File | Description |
| :--- | :--- |
| **`Phone_Rental_Service_27062026.pdf`** | The 26-page source PDF agreement document. |
| **`Phone_Rental_Service_Template.json`** | Complete JSON export containing all 23 field definitions, exact coordinates, submitters, and base64-encoded PDF. |
| **`import_template.rb`** | 1-step Ruby runner script to import the template and PDF directly into any DocuSeal Rails instance. |

---

## 🚀 Usage via Docker / Rails Runner

```bash
docker cp Phone_Rental_Service_Template.json <container_name>:/tmp/
docker cp import_template.rb <container_name>:/tmp/
docker exec -w /app <container_name> bundle exec rails runner /tmp/import_template.rb /tmp/Phone_Rental_Service_Template.json
```
