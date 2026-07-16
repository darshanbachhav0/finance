import ResourceManager from "../components/ResourceManager.jsx";

export default function AdminUsers() {
  return (
    <ResourceManager
      title="Admin Users"
      description="Manage seeded and manually created users, roles, and active status."
      endpoint="/users"
      deleteMode="deactivate"
      duplicateFields={["email"]}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "password", label: "Password", type: "password", requiredOnCreate: true, hint: "Required when creating a user." },
        { name: "role", label: "Role", type: "select", required: true, options: ["Admin", "Solicitor", "Approver", "Accounting", "Treasury"] },
        { name: "area", label: "Area", defaultValue: "General" },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
        { key: "role", label: "Role" },
        { key: "area", label: "Area" },
        { key: "active", label: "Active", render: (row) => (row.active ? "Yes" : "No") }
      ]}
      transformSubmit={(form) => {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        return payload;
      }}
    />
  );
}
